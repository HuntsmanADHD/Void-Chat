-- CreateEnum
CREATE TYPE "AppealStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "Appeal" (
    "id" TEXT NOT NULL,
    "strikeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "AppealStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "Appeal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Appeal_strikeId_key" ON "Appeal"("strikeId");

-- CreateIndex
CREATE INDEX "Appeal_userId_idx" ON "Appeal"("userId");

-- CreateIndex
CREATE INDEX "Appeal_status_idx" ON "Appeal"("status");

-- CreateIndex
CREATE INDEX "Appeal_createdAt_idx" ON "Appeal"("createdAt");

-- AddForeignKey
ALTER TABLE "Appeal" ADD CONSTRAINT "Appeal_strikeId_fkey" FOREIGN KEY ("strikeId") REFERENCES "Strike"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appeal" ADD CONSTRAINT "Appeal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appeal" ADD CONSTRAINT "Appeal_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
