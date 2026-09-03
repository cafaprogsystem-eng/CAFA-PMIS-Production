import { type FullSlide } from "./full-system-video-script";

// Deep-dive standalone video for the Communication Centre — a module the
// full-system overview never covers at all. Accurate against
// routes/conversations.ts as of this writing: direct and group/scoped
// conversations, @mentions, reactions, and message editing/pinning.

export const COMMUNICATION_MODULE_SCRIPT: FullSlide[] = [

  {
    type: "intro",
    titleEn: "Communication Centre",
    pointsEn: ["Deep Dive", "English Voice-Over Guide", "CAFA Development Organization"],
    narrationEn: "Welcome to the deep-dive training video on the Communication Centre — messaging, mentions, and staying in the loop with your team.",
    durationHint: 8,
  },

  {
    type: "section-header",
    sectionNum: 1, sectionEn: "Starting a Conversation", sectionAr: "بدء محادثة",
    titleEn: "Starting a Conversation",
    pointsEn: [],
    narrationEn: "Section one: the two kinds of conversation, and starting one.",
    durationHint: 3,
  },
  {
    type: "content",
    sectionNum: 1, sectionEn: "Communication",
    titleEn: "Direct Messages & Group Conversations",
    pointsEn: ["Direct: a private conversation between two people", "Group: can be scoped to a project, a state, or a sector", "A scoped conversation is visible to everyone with access to that scope", "Sending a message needs its own permission, separate from just viewing", "Managing members is a further, separate permission again"],
    narrationEn: "The Communication Centre supports direct conversations between two people, and group conversations that can be scoped to a specific project, state, or sector — visible to everyone with access to that scope. Sending a message and managing a conversation's members are each their own separate permission from simply viewing it.",
    durationHint: 10,
  },

  {
    type: "section-header",
    sectionNum: 2, sectionEn: "Mentions & Reactions", sectionAr: "الإشارات وردود الأفعال",
    titleEn: "Mentions & Reactions",
    pointsEn: [],
    narrationEn: "Section two: mentioning a colleague, and reacting to a message.",
    durationHint: 3,
  },
  {
    type: "content",
    sectionNum: 2, sectionEn: "Communication",
    titleEn: "Mentioning Someone",
    pointsEn: ["Type @ and a name to mention a colleague", "They get a dedicated notification just for that mention", "You can only mention someone who's actually a member of the conversation", "Even Full Operational Access doesn't bypass that membership check", "This keeps mentions meaningful — not a way to page anyone system-wide"],
    narrationEn: "Typing @ and a name mentions a colleague, sending them a dedicated notification. You can only mention someone who's an actual member of that conversation — even a role with full operational access doesn't get to mention people outside it, so a mention always means someone who can genuinely see the message.",
    durationHint: 10,
  },
  {
    type: "content",
    sectionNum: 2, sectionEn: "Communication",
    titleEn: "Reactions, Editing, and Pinning",
    pointsEn: ["React to any message with an emoji", "Edit or delete your own messages afterward", "Pin an important message to the top of the conversation", "Reply to a specific message, or forward it elsewhere", "A media tab collects every image and file shared in the thread"],
    narrationEn: "You can react to any message, edit or delete your own messages after sending, and pin an important one to the top of the conversation. Reply to a specific message or forward it elsewhere, and use the media tab to find every image and file shared in that thread.",
    durationHint: 10,
  },

  {
    type: "outro",
    titleEn: "Communication Centre — Complete",
    pointsEn: ["You know direct vs. scoped group conversations", "You know how mentions, reactions, and pinning work", "For support: pmis-support@cafa.systems", "CAFA Development Organization"],
    narrationEn: "You've now covered direct and scoped group conversations, mentioning a colleague, and reacting to, editing, and pinning messages. For technical support, please reach out at pmis-support@cafa.systems. Thank you for watching.",
    durationHint: 8,
  },
];

export const COMMUNICATION_VIDEO_TITLE = "Communication Centre — Deep Dive";
export const COMMUNICATION_VIDEO_MODULE = "communication";
