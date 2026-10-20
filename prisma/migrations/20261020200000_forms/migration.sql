-- CreateEnum
CREATE TYPE "FormCategory" AS ENUM ('LEASE', 'ADDENDUM', 'NOTICE', 'MOVE', 'VENDOR', 'OTHER');

-- CreateEnum
CREATE TYPE "FormStatus" AS ENUM ('DRAFT', 'FINAL');

-- CreateTable
CREATE TABLE "FormDoc" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "formType" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "category" "FormCategory" NOT NULL,
    "status" "FormStatus" NOT NULL DEFAULT 'DRAFT',
    "body" TEXT NOT NULL DEFAULT '',
    "reviewNotes" TEXT,
    "instructions" TEXT,
    "tenantId" TEXT,
    "leaseId" TEXT,
    "propertyId" TEXT,
    "unitId" TEXT,
    "vendorId" TEXT,
    "templateId" TEXT,
    "documentId" TEXT,
    "model" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "createdByEmail" TEXT,
    "finalizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FormDoc_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FormTemplate" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "category" "FormCategory" NOT NULL,
    "formType" TEXT,
    "description" TEXT,
    "body" TEXT,
    "documentId" TEXT,
    "createdByEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FormTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "FormDoc_documentId_key" ON "FormDoc"("documentId");

-- CreateIndex
CREATE INDEX "FormDoc_state_category_idx" ON "FormDoc"("state", "category");

-- CreateIndex
CREATE UNIQUE INDEX "FormTemplate_documentId_key" ON "FormTemplate"("documentId");

-- CreateIndex
CREATE INDEX "FormTemplate_state_category_idx" ON "FormTemplate"("state", "category");

-- AddForeignKey
ALTER TABLE "FormDoc" ADD CONSTRAINT "FormDoc_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormDoc" ADD CONSTRAINT "FormDoc_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "Lease"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormDoc" ADD CONSTRAINT "FormDoc_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormDoc" ADD CONSTRAINT "FormDoc_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormDoc" ADD CONSTRAINT "FormDoc_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormDoc" ADD CONSTRAINT "FormDoc_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "FormTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormDoc" ADD CONSTRAINT "FormDoc_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormTemplate" ADD CONSTRAINT "FormTemplate_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

