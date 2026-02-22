import { db } from "../lib/db";
import { fees } from "../lib/db/schema";

const FEE_PERCENT = 2; // 2% of profit

export class FeeCalculator {
  async calculateFee(
    followerId: string,
    positionId: string,
    profitAmount: number
  ): Promise<void> {
    if (profitAmount <= 0) {
      console.log(
        `[FeeCalculator] No fee for position ${positionId}: not profitable`
      );
      return;
    }

    const feeAmount = profitAmount * (FEE_PERCENT / 100);

    await db.insert(fees).values({
      followerId,
      positionId,
      profitAmount: String(profitAmount),
      feePercent: String(FEE_PERCENT),
      feeAmount: String(feeAmount),
      status: "calculated",
    });

    console.log(
      `[FeeCalculator] Fee recorded: $${feeAmount.toFixed(2)} (${FEE_PERCENT}% of $${profitAmount.toFixed(2)} profit) for follower ${followerId}`
    );
  }
}
