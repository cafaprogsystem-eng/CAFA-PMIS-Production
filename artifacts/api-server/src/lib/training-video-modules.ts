import { FULL_SYSTEM_SCRIPT, FULL_VIDEO_TITLE, FULL_VIDEO_MODULE } from "./full-system-video-script";
import { LOGIN_MODULE_SCRIPT, LOGIN_VIDEO_TITLE, LOGIN_VIDEO_MODULE } from "./login-module-video-script";
import type { ModuleVideoConfig } from "./video-generator";

// Every generatable training video, keyed by its training_videos.module_name.
// Add a new module video by writing its own <module>-module-video-script.ts
// (see login-module-video-script.ts for the pattern) and registering it here
// — routes/training-videos.ts's generate/regenerate endpoints are generic
// over this registry, so no route changes are needed per new module.
export type ModuleRegistryEntry = ModuleVideoConfig & {
  description: string;
};

export const TRAINING_VIDEO_MODULES: Record<string, ModuleRegistryEntry> = {
  [FULL_VIDEO_MODULE]: {
    moduleKey: FULL_VIDEO_MODULE,
    videoTitle: FULL_VIDEO_TITLE,
    introHeading: "Program Management System",
    introSubtitle: "Complete System Training Guide",
    slides: FULL_SYSTEM_SCRIPT,
    description: "Comprehensive walkthrough of all CAFA PMIS modules with English voice-over and captions.",
  },
  [LOGIN_VIDEO_MODULE]: {
    moduleKey: LOGIN_VIDEO_MODULE,
    videoTitle: LOGIN_VIDEO_TITLE,
    introHeading: "Login & Email Verification",
    introSubtitle: "Module Deep-Dive Training Guide",
    outroBigText: "Module Complete",
    slides: LOGIN_MODULE_SCRIPT,
    description: "Deep dive into signing in, login errors and account lockout, session duration, email verification, and invited-account setup.",
  },
};
