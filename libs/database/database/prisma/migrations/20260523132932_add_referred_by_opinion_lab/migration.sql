-- AlterTable
ALTER TABLE "appointments" ADD COLUMN     "opinion_obtained_by" TEXT,
ADD COLUMN     "referred_by" TEXT;

-- AlterTable
ALTER TABLE "ipd_admissions" ADD COLUMN     "opinion_obtained_by" TEXT,
ADD COLUMN     "referred_by" TEXT;
