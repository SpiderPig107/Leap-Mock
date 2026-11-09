import { Check } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { CONFIG } from "../../lib/config";
import { newIdempotencyKey } from "../../lib/ids";
import { formatCents } from "../../lib/money";
import { Button, Spinner } from "../../ui/Button";
import { useCardStore } from "../card/cardStore";
import { ApplePaySimS09 } from "../topup/ApplePaySimS09";
import { GooglePayButton } from "../topup/GooglePayButton";
import { InAppBrowserBanner } from "../topup/InAppBrowserBanner";
import { isRejection, topUp, type TopUpMethod } from "../topup/topupApi";
import { shouldShowSmartTopUp, tripsLeft, type SmartState } from "./smartTopUp";

const AMOUNT = CONFIG.smartTopUpAmountCents;

/** S15 smart top-up (Flow D): 2 taps from the stop screen to a topped-up card, map stays visible. */
export function SmartTopUpCard() {
  const card = useCardStore((s) => s.card);
  const cardNumber = useCardStore((s) => s.cardNumber);
  const refresh = useCardStore((s) => s.refresh);
  const [state, setState] = useState<SmartState>("idle");
  const [applePay, setApplePay] = useState(false);
  const attempt = useRef<{ method: TopUpMethod; idempotencyKey: string } | null>(null);

  const run = useCallback(async () => {
    const a = attempt.current;
    if (!a || !cardNumber) return;
    setState("processing");
    try {
      const res = await topUp({ cardNumber, amountCents: AMOUNT, ...a });
      useCardStore.setState((s) => ({ card: s.card ? { ...s.card, balanceCents: res.balanceCents } : s.card }));
      setState("done");
      void refresh();
    } catch (err) {
      setState(isRejection(err) ? "rejected" : "error");
    }
  }, [cardNumber, refresh]);

  const paid = (method: TopUpMethod) => {
    setApplePay(false);
    attempt.current = { method, idempotencyKey: newIdempotencyKey() };
    void run();
  };

  if (!card || !shouldShowSmartTopUp(card.balanceCents, state)) return null;

  return (
    <div className="mt-3 rounded-card border border-brand/30 bg-brand-light p-4" aria-live="polite">
      {state === "idle" && (
        <>
          <p className="text-sm font-semibold text-ink">Low balance for your next trips. Top up {formatCents(AMOUNT)} with Google Pay.</p>
          <p className="mt-1 text-xs text-ink-muted">
            {formatCents(card.balanceCents)} covers {tripsLeft(card.balanceCents)} {tripsLeft(card.balanceCents) === 1 ? "trip" : "trips"}.
          </p>
          <div className="mt-3 space-y-3">
            <InAppBrowserBanner />
            <GooglePayButton amountCents={AMOUNT} onPaid={() => paid("GOOGLE_PAY")} onCancel={() => setState("idle")} />
          </div>
          <button type="button" onClick={() => setApplePay(true)} className="mt-2 w-full py-2 text-center text-xs font-semibold text-brand-dark">
            Use Apple Pay (simulated)
          </button>
        </>
      )}
      {state === "processing" && (
        <div className="flex items-center gap-3 py-2">
          <Spinner small />
          <p className="text-sm font-semibold">Topping up your card…</p>
        </div>
      )}
      {state === "done" && (
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand text-white" aria-hidden>
            <Check className="h-5 w-5" strokeWidth={3} />
          </span>
          <div>
            <p className="text-sm font-bold">Topped up. Balance {formatCents(card.balanceCents)}.</p>
            <p className="text-xs text-ink-muted">Enough for {tripsLeft(card.balanceCents)} trips.</p>
          </div>
        </div>
      )}
      {state === "error" && (
        <>
          <p className="text-sm font-semibold text-red-700">Top-up not confirmed. You were not charged.</p>
          <Button className="mt-3" onClick={() => void run()}>
            Try again
          </Button>
        </>
      )}
      {state === "rejected" && (
        <>
          <p className="text-sm font-semibold text-red-700">Top-up not completed. You were not charged.</p>
          <Button variant="secondary" className="mt-3" onClick={() => setState("idle")}>
            OK
          </Button>
        </>
      )}
      {applePay && <ApplePaySimS09 amountCents={AMOUNT} onPaid={() => paid("APPLE_PAY_SIM")} onClose={() => setApplePay(false)} />}
    </div>
  );
}
