-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'REPLY_RECEIVED';

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "parentId" TEXT,
ADD COLUMN     "replyCount" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "Message_parentId_idx" ON "Message"("parentId");

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;
