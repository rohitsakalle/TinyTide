// Increment when competitive course generation, physics or scoring rules change.
export const DAILY_RULES = "tide-boost-3";
export const GAME_URL = "https://rohitsakalle.github.io/TinyTide/";

export function dailyResultText(result) {
  return [
    `Tiny Tide Daily · ${result.date} UTC`,
    `${result.score} points · ${result.distance} m · ${result.bonus} bonus points`,
    `${result.coins} coins · ${result.passed} obstacles · ${result.perfects} perfect passes`,
    `Fixed Medium · ${DAILY_RULES}`,
    GAME_URL,
  ].join("\n");
}

export async function shareDaily(text, platform = navigator) {
  if (typeof platform.share !== "function") return { status: "manual", message: "Sharing isn't available here. Use Copy result or select the text below." };
  try {
    await platform.share({ title: "Tiny Tide Daily", text });
    return { status: "shared", message: "Result sent to your chosen share destination." };
  } catch (error) {
    if (error?.name === "AbortError") return { status: "cancelled", message: "Share cancelled. Nothing was copied." };
    return { status: "error", message: "Couldn't share. Use Copy result or select the text below.", error };
  }
}

export async function copyDaily(text, platform = navigator) {
  if (typeof platform.clipboard?.writeText !== "function") return { status: "manual", message: "Clipboard isn't available here. Select and copy the result text below." };
  try {
    await platform.clipboard.writeText(text);
    return { status: "copied", message: "Daily result copied." };
  } catch (error) {
    return { status: "error", message: "Couldn't copy automatically. Select and copy the result text below.", error };
  }
}
