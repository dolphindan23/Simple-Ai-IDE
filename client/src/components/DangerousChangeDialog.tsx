import { AlertTriangle, FileX, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

interface DangerSummary {
  deletedFiles: string[];
  sensitiveEdits: string[];
}

interface DangerousChangeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dangerSummary: DangerSummary | null;
  confirmationToken: string | null;
  diffName: string;
  onConfirm: (confirmationToken: string, diffName: string) => void;
  isConfirming: boolean;
}

export function DangerousChangeDialog({
  open,
  onOpenChange,
  dangerSummary,
  confirmationToken,
  diffName,
  onConfirm,
  isConfirming,
}: DangerousChangeDialogProps) {
  if (!dangerSummary || !confirmationToken) return null;

  const hasDeletedFiles = dangerSummary.deletedFiles.length > 0;
  const hasSensitiveEdits = dangerSummary.sensitiveEdits.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="dialog-dangerous-change">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            Dangerous Changes Detected
          </DialogTitle>
          <DialogDescription>
            This patch contains potentially dangerous changes that require your confirmation before applying.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {hasDeletedFiles && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium text-destructive">
                <FileX className="h-4 w-4" />
                Files to be deleted ({dangerSummary.deletedFiles.length})
              </div>
              <ScrollArea className="max-h-[120px]">
                <div className="space-y-1">
                  {dangerSummary.deletedFiles.map((file, i) => (
                    <Badge key={i} variant="destructive" className="mr-1 mb-1 text-xs font-mono">
                      {file}
                    </Badge>
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}

          {hasSensitiveEdits && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium text-yellow-500">
                <Shield className="h-4 w-4" />
                Sensitive paths modified ({dangerSummary.sensitiveEdits.length})
              </div>
              <ScrollArea className="max-h-[120px]">
                <div className="space-y-1">
                  {dangerSummary.sensitiveEdits.map((file, i) => (
                    <Badge key={i} variant="outline" className="mr-1 mb-1 text-xs font-mono border-yellow-500 text-yellow-500">
                      {file}
                    </Badge>
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isConfirming}
            data-testid="button-cancel-dangerous"
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => onConfirm(confirmationToken, diffName)}
            disabled={isConfirming}
            data-testid="button-confirm-dangerous"
          >
            {isConfirming ? "Applying..." : "I Understand, Apply Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
