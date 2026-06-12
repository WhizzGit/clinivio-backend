import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource, In } from "typeorm";
import Anthropic from "@anthropic-ai/sdk";
import { ConfigService } from "@nestjs/config";
import { Redis } from "ioredis";
import { InjectRedis } from "@nestjs-modules/ioredis";
import {
  Patient,
  Consultation,
  LabOrder,
  TenantDataSourceRegistry,
} from "@mediflow/database";
import { AuditService } from "../audit/audit.service";

// ── De-identified shape sent to Claude — NO PII ───────────────────────────────

interface AnonymisedVisit {
  daysAgo: number; // relative — not absolute date
  visitType: string; // OPD / IPD / EMERGENCY
  chiefComplaint?: string;
  diagnosis?: string;
  observations?: string;
  vitals?: {
    bp?: string;
    pulseRate?: number;
    temperature?: number;
    spo2?: number;
    weightKg?: number;
    bmi?: number;
    rbsMgDl?: number;
  };
  medications: Array<{
    name: string; // medicine name only — no patient identifiers
    dosage: string;
    frequency: string;
    duration: string;
  }>;
  labResults: Array<{
    test: string;
    result: string;
    unit?: string;
    flag?: string; // NORMAL | ABNORMAL | CRITICAL
  }>;
}

interface AnonymisedProfile {
  ageInYears: number; // computed from DOB — not the DOB itself
  sex: string;
  bloodGroup?: string; // clinical, not identifying
  visits: AnonymisedVisit[];
}

const CACHE_TTL_SECONDS = 86_400; // 24 h

const SYSTEM_PROMPT = `You are a clinical documentation assistant embedded in a hospital information system.
Your sole purpose is to produce a concise, structured clinical summary for physician review.

STRICT RULES:
1. You receive de-identified data only. Never attempt to infer or reconstruct patient identity.
2. Do not reference names, contact details, record numbers, or any personal identifiers.
3. Output only clinical insights — patterns, trends, concerns, and medication summary.
4. Use hedged language ("consistent with", "may suggest", "warrants monitoring").
5. Never make a definitive diagnosis.
6. Flag any ABNORMAL or CRITICAL lab values explicitly.
7. Identify recurring medications across visits.
8. Keep the total response under 400 words.
9. Use exactly this structure:

## Clinical Overview
[2–3 sentences describing the visit pattern and primary concerns]

## Key Clinical Concerns
[Bullet list of 3–5 concerns or findings worth monitoring]

## Medication Summary
[Bullet list: medication name — dosage — frequency — last prescribed]

## Trends & Alerts
[Notable vital or lab trends; flag any CRITICAL values]

## Suggested Follow-up Considerations
[1–3 clinical follow-up actions based solely on the data]

---
*AI-generated summary — for clinical reference only. Not a substitute for physician assessment.*`;

@Injectable()
export class AiService {
  private readonly client: Anthropic;
  private readonly logger = new Logger(AiService.name);

  constructor(
    @InjectDataSource() private readonly platformDs: DataSource,
    private readonly registry: TenantDataSourceRegistry,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    @InjectRedis() private readonly redis: Redis,
  ) {
    this.client = new Anthropic({
      apiKey: this.config.getOrThrow<string>("ANTHROPIC_API_KEY"),
    });
  }

  // ── Anonymiser — strips all PII before anything leaves the system ─────────────

  private anonymise(
    patient: Patient,
    consultations: Consultation[],
    labOrders: LabOrder[],
  ): AnonymisedProfile {
    const ageInYears = patient.dob
      ? Math.floor(
          (Date.now() - new Date(patient.dob).getTime()) /
            (365.25 * 24 * 3600 * 1000),
        )
      : 0;

    const ordersMap = new Map<string, LabOrder[]>();
    for (const o of labOrders) {
      if (!o.appointmentId) continue;
      if (!ordersMap.has(o.appointmentId)) ordersMap.set(o.appointmentId, []);
      ordersMap.get(o.appointmentId)!.push(o);
    }

    const now = Date.now();

    const visits: AnonymisedVisit[] = consultations.map((c) => {
      const visitDate = new Date(c.createdAt);
      const daysAgo = Math.floor(
        (now - visitDate.getTime()) / (24 * 3600 * 1000),
      );

      const medications = (c.prescriptions ?? []).flatMap((rx) =>
        (rx.items ?? []).map((item) => ({
          name: item.medicineName, // medicine name — not PII
          dosage: item.dosage,
          frequency: item.frequency,
          duration: item.duration,
        })),
      );

      const apptLabOrders = ordersMap.get(c.appointmentId ?? "") ?? [];
      const labResults = apptLabOrders.flatMap((o) =>
        (o.items ?? [])
          .filter((item) => item.result)
          .map((item) => ({
            test: item.labTest?.name ?? "Unknown",
            result: item.result!,
            unit: item.unit ?? undefined,
            flag: item.flag ?? undefined,
          })),
      );

      const vitals: AnonymisedVisit["vitals"] = {};
      if (c.bpSystolic && c.bpDiastolic)
        vitals.bp = `${c.bpSystolic}/${c.bpDiastolic} mmHg`;
      if (c.pulseRate) vitals.pulseRate = c.pulseRate;
      if (c.temperature) vitals.temperature = Number(c.temperature);
      if (c.spo2) vitals.spo2 = c.spo2;
      if (c.weightKg) vitals.weightKg = Number(c.weightKg);
      if (c.bmi) vitals.bmi = Number(c.bmi);
      if (c.rbsMgDl) vitals.rbsMgDl = c.rbsMgDl;

      return {
        daysAgo,
        visitType: c.appointment?.visitType ?? "OPD",
        chiefComplaint: c.appointment?.chiefComplaint ?? undefined,
        diagnosis: c.diagnosis ?? undefined,
        observations: c.observations ?? undefined,
        vitals: Object.keys(vitals).length ? vitals : undefined,
        medications,
        labResults,
      };
    });

    return {
      ageInYears,
      sex: patient.gender ?? "Unknown",
      bloodGroup: patient.bloodGroup ?? undefined,
      visits,
    };
  }

  // ── Output sanitiser — last-line defence against PII leaking back ─────────────

  private sanitiseOutput(text: string): string {
    // Strip anything that looks like a phone number, email, or UUID
    return text
      .replace(/\b\d{10,12}\b/g, "[REDACTED]")
      .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "[REDACTED]")
      .replace(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
        "[REDACTED]",
      );
  }

  // ── Main entry point ──────────────────────────────────────────────────────────

  async getSummary(
    patientId: string,
    tenantId: string,
    requestUserId: string,
    forceRefresh = false,
  ) {
    const cacheKey = `ai_summary:${tenantId}:${patientId}`;

    if (!forceRefresh) {
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        return { ...JSON.parse(cached), fromCache: true };
      }
    }

    // Fetch clinical data from tenant DB — no PII fields beyond what anonymiser drops
    const tenantDs = await this.registry.getOrCreate(tenantId, "");
    const patient = await tenantDs.getRepository(Patient).findOne({
      where: { id: patientId, tenantId },
      select: ["id", "dob", "gender", "bloodGroup"], // explicitly exclude name, phone, email, uhid
    });
    if (!patient) throw new NotFoundException("Patient not found");

    const consultations = await tenantDs.getRepository(Consultation).find({
      where: { patientId, tenantId },
      relations: ["appointment", "prescriptions", "prescriptions.items"],
      order: { createdAt: "DESC" },
      take: 20,
    });

    if (!consultations.length) {
      return {
        summary: null,
        reason: "No consultation history available yet",
        fromCache: false,
      };
    }

    const apptIds = consultations
      .map((c) => c.appointmentId)
      .filter(Boolean) as string[];
    const labOrders = apptIds.length
      ? await tenantDs.getRepository(LabOrder).find({
          where: { appointmentId: In(apptIds), tenantId },
          relations: ["items", "items.labTest"],
        })
      : [];

    const anonymised = this.anonymise(patient, consultations, labOrders);

    // Build the user message — only de-identified clinical JSON
    const userMessage = `Generate a clinical summary for the following de-identified patient data:\n\n${JSON.stringify(anonymised, null, 2)}`;

    let rawSummary: string;
    try {
      const response = await this.client.messages.create({
        model: "claude-haiku-4-5-20251001", // fast + cost-efficient for summaries
        max_tokens: 800,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
      });

      const block = response.content.find((b) => b.type === "text");
      rawSummary = block?.type === "text" ? block.text : "";
    } catch (err: any) {
      this.logger.error("[AI] Claude API call failed:", err?.message);
      throw err;
    }

    const summary = this.sanitiseOutput(rawSummary);

    const result = {
      summary,
      visitCount: consultations.length,
      generatedAt: new Date().toISOString(),
      fromCache: false,
    };

    await this.redis.setex(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(result));

    // Audit the AI call — no patient data in the log
    await this.audit.log({
      tenantId,
      userId: requestUserId,
      action: "AI_SUMMARY",
      entityType: "Patient",
      entityId: patientId,
      description: `AI clinical summary generated (${consultations.length} consultations analysed)`,
      metadata: {
        model: "claude-haiku-4-5-20251001",
        visitCount: consultations.length,
      },
    });

    return result;
  }

  async invalidateCache(patientId: string, tenantId: string) {
    await this.redis.del(`ai_summary:${tenantId}:${patientId}`);
  }
}
