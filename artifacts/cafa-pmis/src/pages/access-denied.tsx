import { useTranslation } from "react-i18next";
import { ShieldOff, ArrowLeft, Home } from "@/components/icons";
import { useLocation } from "wouter";
import { Button } from "@heroui/react";

export default function AccessDeniedPage() {
  const { t } = useTranslation("errors");
  const [, navigate] = useLocation();

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f5f6fa]">
      <div className="text-center space-y-6 max-w-md px-4">
        <div className="flex justify-center">
          <div className="rounded-full bg-red-100 p-6">
            <ShieldOff className="h-14 w-14 text-red-500" />
          </div>
        </div>

        <div className="space-y-2">
          <h1 className="text-foreground text-xl font-semibold">{t("accessDenied")}</h1>
          <p className="text-muted-foreground text-sm leading-relaxed">
            {t("accessDeniedDesc")}
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Button variant="outline" onPress={() => window.history.back()}>
            <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
            {t("goBack")}
          </Button>
          <Button onPress={() => navigate("/")}>
            <Home className="h-4 w-4" />
            {t("goHome")}
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          {t("cafaPMIS")}
        </p>
      </div>
    </div>
  );
}
