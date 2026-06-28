import { Injectable } from "@nestjs/common";
import { In } from "typeorm";
import {
  Patient,
  Prescription,
  PrescriptionItem,
  Consultation,
  TenantEntityManager,
} from "@mediflow/database";
import { AiService } from "../ai/ai.service";

export const COMMON_CONDITIONS = [
  "Diabetic (Type 1)",
  "Diabetic (Type 2)",
  "Pre-Diabetic",
  "Hypertension",
  "Hypotension",
  "Anemia (Iron Deficiency)",
  "Anemia (Megaloblastic)",
  "Asthma",
  "COPD",
  "Bronchitis",
  "CKD (Chronic Kidney Disease)",
  "AKI",
  "CAD (Coronary Artery Disease)",
  "Heart Failure",
  "Arrhythmia",
  "Thyroid (Hypothyroid)",
  "Thyroid (Hyperthyroid)",
  "Obesity",
  "Underweight",
  "Anxiety",
  "Depression",
  "Bipolar Disorder",
  "Arthritis (Rheumatoid)",
  "Arthritis (Osteo)",
  "Gout",
  "Migraine",
  "Epilepsy",
  "Parkinson's",
  "Liver Disease (NAFLD)",
  "Liver Disease (Cirrhosis)",
  "Hepatitis B",
  "Hepatitis C",
  "Cancer",
  "Stroke / TIA",
  "Pregnancy",
  "Post-Surgical",
  "Immunocompromised",
  "Dengue",
  "Malaria",
  "Typhoid",
  "TB",
  "Sickle Cell",
  "Thalassemia",
  "Psoriasis",
  "Eczema",
  "PCOD / PCOS",
  "Endometriosis",
  "Glaucoma",
  "Cataracts",
  "Diabetic Retinopathy",
];

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly db: TenantEntityManager,
    private readonly ai: AiService,
  ) {}

  // ── Condition distribution ────────────────────────────────────────────────────

  async getConditionDistribution(tenantId: string) {
    const patients = await this.db.repo(Patient).find({
      where: { tenantId, isActive: true },
      select: ["id", "conditions"],
    });

    const counts: Record<string, number> = {};
    for (const p of patients) {
      for (const c of p.conditions ?? []) {
        if (c) counts[c] = (counts[c] ?? 0) + 1;
      }
    }

    const total = patients.length || 1;
    return {
      totalPatients: patients.length,
      patientsTagged: patients.filter((p) => (p.conditions ?? []).length > 0)
        .length,
      distribution: Object.entries(counts)
        .map(([condition, count]) => ({
          condition,
          count,
          percentage: Math.round((count / total) * 100),
        }))
        .sort((a, b) => b.count - a.count),
    };
  }

  // ── Top prescribed medicines per condition ────────────────────────────────────

  async getMedicinePatterns(tenantId: string, condition?: string) {
    const patients = await this.db.repo(Patient).find({
      where: { tenantId, isActive: true },
      select: ["id", "conditions"],
    });

    const targetIds = condition
      ? patients
          .filter((p) => (p.conditions ?? []).includes(condition))
          .map((p) => p.id)
      : patients.map((p) => p.id);

    if (!targetIds.length)
      return { condition: condition ?? "All", medicines: [] };

    const prescriptions = await this.db.repo(Prescription).find({
      where: { tenantId, patientId: In(targetIds) },
      relations: ["items"],
    });

    const medicineCounts: Record<string, number> = {};
    for (const rx of prescriptions) {
      for (const item of rx.items ?? []) {
        const name = item.medicineName.trim();
        if (name) medicineCounts[name] = (medicineCounts[name] ?? 0) + 1;
      }
    }

    const medicines = Object.entries(medicineCounts)
      .map(([medicine, count]) => ({ medicine, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15);

    return {
      condition: condition ?? "All",
      patientCount: targetIds.length,
      medicines,
    };
  }

  // ── Vital trends for a condition ──────────────────────────────────────────────

  async getVitalTrends(tenantId: string, condition: string) {
    const patients = await this.db.repo(Patient).find({
      where: { tenantId, isActive: true },
      select: ["id", "conditions"],
    });

    const targetIds = patients
      .filter((p) => (p.conditions ?? []).includes(condition))
      .map((p) => p.id);

    if (!targetIds.length) return { condition, vitals: {} };

    const consultations = await this.db.repo(Consultation).find({
      where: { tenantId, patientId: In(targetIds) },
      select: [
        "bpSystolic",
        "bpDiastolic",
        "pulseRate",
        "spo2",
        "rbsMgDl",
        "bmi",
      ],
    });

    const sum = {
      bpSystolic: 0,
      bpDiastolic: 0,
      pulseRate: 0,
      spo2: 0,
      rbsMgDl: 0,
      bmi: 0,
    };
    const cnt = {
      bpSystolic: 0,
      bpDiastolic: 0,
      pulseRate: 0,
      spo2: 0,
      rbsMgDl: 0,
      bmi: 0,
    };

    for (const c of consultations) {
      if (c.bpSystolic) {
        sum.bpSystolic += c.bpSystolic;
        cnt.bpSystolic++;
      }
      if (c.bpDiastolic) {
        sum.bpDiastolic += c.bpDiastolic;
        cnt.bpDiastolic++;
      }
      if (c.pulseRate) {
        sum.pulseRate += c.pulseRate;
        cnt.pulseRate++;
      }
      if (c.spo2) {
        sum.spo2 += c.spo2;
        cnt.spo2++;
      }
      if (c.rbsMgDl) {
        sum.rbsMgDl += Number(c.rbsMgDl);
        cnt.rbsMgDl++;
      }
      if (c.bmi) {
        sum.bmi += Number(c.bmi);
        cnt.bmi++;
      }
    }

    const avg = (key: keyof typeof sum) =>
      cnt[key] > 0 ? Math.round((sum[key] / cnt[key]) * 10) / 10 : null;

    return {
      condition,
      patientCount: targetIds.length,
      consultationCount: consultations.length,
      averageVitals: {
        bpSystolic: avg("bpSystolic"),
        bpDiastolic: avg("bpDiastolic"),
        pulseRate: avg("pulseRate"),
        spo2: avg("spo2"),
        rbsMgDl: avg("rbsMgDl"),
        bmi: avg("bmi"),
      },
    };
  }

  // ── AI population insights ─────────────────────────────────────────────────────

  async getAiInsights(tenantId: string, requestUserId: string) {
    const { totalPatients, patientsTagged, distribution } =
      await this.getConditionDistribution(tenantId);

    const topConditions = distribution.slice(0, 8);

    const topMeds: Array<{ condition: string; topMedicines: string[] }> = [];
    for (const { condition } of topConditions.slice(0, 5)) {
      const { medicines } = await this.getMedicinePatterns(tenantId, condition);
      topMeds.push({
        condition,
        topMedicines: medicines.slice(0, 5).map((m) => m.medicine),
      });
    }

    const payload = {
      totalPatients,
      patientsWithConditionTags: patientsTagged,
      conditionDistribution: topConditions,
      topPrescribedMedicinesPerCondition: topMeds,
    };

    return this.ai.getPopulationInsights(payload, tenantId, requestUserId);
  }

  // ── AI prescription suggestions ───────────────────────────────────────────────

  async getPrescriptionSuggestions(
    patientId: string,
    tenantId: string,
    conditions: string[],
    diagnosis: string,
    observations?: string,
    ageInYears?: number,
    gender?: string,
  ) {
    return this.ai.getPrescriptionSuggestions({
      conditions,
      diagnosis,
      observations,
      ageInYears,
      gender,
    });
  }
}
