import { useTranslation } from "react-i18next";
import { AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface ConflictDialogProps {
  open: boolean;
  /** Keep the user's in-progress changes and force-save */
  onKeepMine: () => void;
  /** Discard local changes and reload the latest server version */
  onLoadLatest: () => void;
  /** Dismiss — keep editing without saving */
  onCancel: () => void;
}

export function ConflictDialog({
  open,
  onKeepMine,
  onLoadLatest,
  onCancel,
}: ConflictDialogProps) {
  const { t } = useTranslation("common");

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onCancel(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-amber-700">
            <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0" />
            {t("conflict.title")}
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground leading-relaxed">
          {t("conflict.description")}
        </p>
        <ul className="text-sm space-y-1 text-muted-foreground list-disc ms-4">
          <li>
            <span className="font-medium text-foreground">{t("conflict.loadLatestLabel")}</span> —{" "}
            {t("conflict.loadLatestDesc")}
          </li>
          <li>
            <span className="font-medium text-foreground">{t("conflict.saveMineLabel")}</span> —{" "}
            {t("conflict.saveMineDesc")}
          </li>
          <li>
            <span className="font-medium text-foreground">{t("conflict.keepEditingLabel")}</span> —{" "}
            {t("conflict.keepEditingDesc")}
          </li>
        </ul>
        <DialogFooter className="flex-col sm:flex-row gap-2 pt-2">
          <Button variant="outline" onClick={onCancel} className="w-full sm:w-auto">
            {t("conflict.keepEditingButton")}
          </Button>
          <Button variant="outline" onClick={onLoadLatest} className="w-full sm:w-auto">
            {t("conflict.loadLatestButton")}
          </Button>
          <Button
            variant="destructive"
            onClick={onKeepMine}
            className="w-full sm:w-auto"
          >
            {t("conflict.saveMineButton")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
