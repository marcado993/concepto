-- CreateEnum
CREATE TYPE "JobKind" AS ENUM ('INTERNSHIP', 'FULL_TIME', 'PART_TIME', 'CONTRACT');

-- CreateEnum
CREATE TYPE "JobSeniority" AS ENUM ('INTERN', 'JUNIOR', 'MID', 'SENIOR', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "JobWorkMode" AS ENUM ('ONSITE', 'HYBRID', 'REMOTE');

-- CreateTable
CREATE TABLE "job_offers" (
    "id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "location" TEXT,
    "kind" "JobKind" NOT NULL,
    "seniority" "JobSeniority" NOT NULL,
    "workMode" "JobWorkMode" NOT NULL,
    "salaryMin" DOUBLE PRECISION,
    "salaryMax" DOUBLE PRECISION,
    "salaryCurrency" TEXT,
    "tags" TEXT[],
    "relevance" INTEGER NOT NULL,
    "reasons" TEXT[],
    "postedAt" TIMESTAMP(3),
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "job_offers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "job_offers_fingerprint_key" ON "job_offers"("fingerprint");

-- CreateIndex
CREATE INDEX "job_offers_active_relevance_idx" ON "job_offers"("active", "relevance");

-- CreateIndex
CREATE INDEX "job_offers_active_kind_idx" ON "job_offers"("active", "kind");

-- CreateIndex
CREATE INDEX "job_offers_source_idx" ON "job_offers"("source");
