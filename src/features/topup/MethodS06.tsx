import { ChevronRight, CreditCard } from "lucide-react";
import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { formatCents } from "../../lib/money";
import { Screen } from "../../ui/Screen";
import { useCardStore } from "../card/cardStore";
import { ApplePaySimS09 } from "./ApplePaySimS09";
import { GooglePayButton } from "./GooglePayButton";
import { InAppBrowserBanner } from "./InAppBrowserBanner";
import type { TopUpMethod } from "./topupApi";
import { useTopUpStore } from "./topupStore";

export function MethodS06() {
  const navigate = useNavigate();
  const card = useCardStore((s) => s.card);
  const { amountCents, start } = useTopUpStore();
  const [applePay, setApplePay] = useState(false);
  if (!card) return <Navigate to="/" replace />;

  const pay = (method: TopUpMethod) => {
    start(method);
    navigate("/topup/processing", { replace: true });
  };

  return (
    <Screen back="/topup" title="Pay with">
      <p className="text-sm text-ink-muted">Top-up {formatCents(amountCents)}</p>
      <div className="mt-4 space-y-3">
        <InAppBrowserBanner />
        <GooglePayButton amountCents={amountCents} onPaid={() => pay("GOOGLE_PAY")} onCancel={() => {}} />
        <p className="-mt-1 text-center text-[11px] text-ink-muted">Google Pay TEST mode · no real charge</p>
        <button
          onClick={() => setApplePay(true)}
          className="flex min-h-[48px] w-full items-center justify-center rounded-full bg-black text-base font-semibold text-white"
        >
           Pay <span className="ml-2 rounded bg-white/20 px-1.5 text-[10px]">SIMULATED</span>
        </button>
        <button
          onClick={() => navigate("/topup/confirm")}
          className="flex min-h-[56px] w-full items-center justify-between rounded-2xl border-2 border-neutral-200 px-4 text-left font-semibold active:bg-neutral-50"
        >
          <span className="flex items-center gap-3">
            <CreditCard className="h-5 w-5 text-ink-muted" aria-hidden />
            Saved card •••• 4242
          </span>
          <ChevronRight className="h-5 w-5 text-ink-muted" aria-hidden />
        </button>
      </div>
      {applePay && <ApplePaySimS09 amountCents={amountCents} onPaid={() => pay("APPLE_PAY_SIM")} onClose={() => setApplePay(false)} />}
    </Screen>
  );
}
