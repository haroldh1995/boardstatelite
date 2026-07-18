import {
  CROSS_APP_UNAVAILABLE_REASON,
  DEEP_LINK_UNAVAILABLE_REASON,
} from "./state";
import type {
  CrossAppLaunchResult,
  CrossAppLaunchTarget,
  DeepLinkAction,
  DeepLinkPreparationResult,
} from "./types";

export class CrossAppLaunchManager {
  prepareLaunch(target: CrossAppLaunchTarget): CrossAppLaunchResult {
    return {
      ok: false,
      status: "unavailable",
      target,
      reason: CROSS_APP_UNAVAILABLE_REASON,
    };
  }

  launch(target: CrossAppLaunchTarget): CrossAppLaunchResult {
    return this.prepareLaunch(target);
  }

  prepareDeepLink(
    action: DeepLinkAction,
    target: CrossAppLaunchTarget | null = null,
  ): DeepLinkPreparationResult {
    return {
      ok: false,
      status: "unavailable",
      action,
      target,
      url: null,
      reason: DEEP_LINK_UNAVAILABLE_REASON,
    };
  }
}

export const crossAppLaunchManager = new CrossAppLaunchManager();
