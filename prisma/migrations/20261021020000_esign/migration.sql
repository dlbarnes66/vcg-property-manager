-- CreateEnum
CREATE TYPE "SignatureRequestStatus" AS ENUM ('PENDING', 'COMPLETED', 'DECLINED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SignerRole" AS ENUM ('LANDLORD', 'TENANT', 'COSIGNER', 'VENDOR', 'OTHER');

-- CreateEnum
CREATE TYPE "SignerStatus" AS ENUM ('PENDING', 'SIGNED', 'DECLINED');

-- CreateTable
CREATE TABLE "SignatureRequest" (
    "id" TEXT NOT NULL,
    "formDocId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "SignatureRequestStatus" NOT NULL DEFAULT 'PENDING',
    "message" TEXT,
    "bodySnapshot" TEXT NOT NULL,
    "originalKey" TEXT NOT NULL,
    "originalHash" TEXT NOT NULL,
    "pageCount" INTEGER NOT NULL,
    "signedDocumentId" TEXT,
    "signedHash" TEXT,
    "createdByEmail" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SignatureRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Signer" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "role" "SignerRole" NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "tenantId" TEXT,
    "isOwner" BOOLEAN NOT NULL DEFAULT false,
    "tokenHash" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "status" "SignerStatus" NOT NULL DEFAULT 'PENDING',
    "signatureType" TEXT,
    "signatureText" TEXT,
    "signatureImage" TEXT,
    "consentAt" TIMESTAMP(3),
    "signedAt" TIMESTAMP(3),
    "declinedReason" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Signer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SignatureEvent" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "signerId" TEXT,
    "type" TEXT NOT NULL,
    "detail" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SignatureEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SignatureRequest_signedDocumentId_key" ON "SignatureRequest"("signedDocumentId");

-- CreateIndex
CREATE INDEX "SignatureRequest_status_idx" ON "SignatureRequest"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Signer_tokenHash_key" ON "Signer"("tokenHash");

-- CreateIndex
CREATE INDEX "Signer_tenantId_status_idx" ON "Signer"("tenantId", "status");

-- CreateIndex
CREATE INDEX "SignatureEvent_requestId_at_idx" ON "SignatureEvent"("requestId", "at");

-- AddForeignKey
ALTER TABLE "SignatureRequest" ADD CONSTRAINT "SignatureRequest_formDocId_fkey" FOREIGN KEY ("formDocId") REFERENCES "FormDoc"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignatureRequest" ADD CONSTRAINT "SignatureRequest_signedDocumentId_fkey" FOREIGN KEY ("signedDocumentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Signer" ADD CONSTRAINT "Signer_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "SignatureRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Signer" ADD CONSTRAINT "Signer_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignatureEvent" ADD CONSTRAINT "SignatureEvent_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "SignatureRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignatureEvent" ADD CONSTRAINT "SignatureEvent_signerId_fkey" FOREIGN KEY ("signerId") REFERENCES "Signer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

