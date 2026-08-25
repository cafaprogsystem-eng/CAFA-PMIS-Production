import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const currentPermissions = { value: ["messages.send", "messages.attachments.upload"] as string[] };
const mediaFailure = { value: false };
const connectivity = { online: true };
const sharedSocket = {
  connected: true,
  on: vi.fn(),
  off: vi.fn(),
  emit: vi.fn(),
};

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en", dir: () => "ltr", changeLanguage: vi.fn() },
  }),
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetMe: () => ({
    data: {
      user: { id: 7, name: "Messaging User", role: "state_program_officer" },
      permissions: currentPermissions.value,
    },
  }),
}));

vi.mock("wouter", () => ({
  useParams: () => ({ conversationId: "101" }),
  useLocation: () => ["/messages/101", vi.fn()],
}));

vi.mock("@/lib/socket", () => ({
  useSocket: () => ({ socket: sharedSocket, status: "connected" }),
}));

vi.mock("@/contexts/sync-context", () => ({
  useSyncContext: () => ({ isOnline: connectivity.online }),
}));

vi.mock("emoji-picker-react", () => ({
  default: () => <div data-testid="emoji-picker" />,
}));

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/conversations/101/media") && mediaFailure.value) {
      return { ok: false, status: 503, json: async () => ({ error: "media_unavailable" }) } as Response;
    }
    const body = url.includes("/conversations/101/messages?")
      ? {
          items: [{
            id: 501, conversationId: 101, senderId: 7, senderName: "Messaging User", senderRoleLabel: "State Programme Officer",
            body: "Photo for review", attachments: [{ type: "image", url: "/message-image.jpg", name: "review-photo.jpg" }],
            replyToId: null, replyBody: null, replySenderName: null, editedAt: null, deletedAt: null, deletionType: null,
            createdAt: "2026-08-20T10:00:00.000Z", isPinned: false, pinnedBy: null, pinnedAt: null, forwardedFromId: null, reactions: [],
          }],
          hasMore: false,
          nextCursor: null,
        }
      : url.includes("/conversations/101?")
      ? []
      : url.endsWith("/conversations/101")
        ? {
            id: 101,
            type: "direct",
            name: "Direct conversation",
            createdById: 7,
            members: [{ id: 7, name: "Messaging User", role: "state_program_officer", roleLabel: "State Programme Officer", lastSeenAt: null, isAdmin: false }],
          }
        : url.includes("/conversations")
          ? { items: [], hasMore: false, nextCursor: null }
          : [];
    return { ok: true, status: 200, json: async () => body } as Response;
  }) as never;
});

import Messages, { mergeConversationPages, mergeMessageHistory, parseConversationRouteId } from "../pages/messages";

function renderMessages() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Messages />
    </QueryClientProvider>,
  );
}

describe("Communication Centre upload controls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sharedSocket.connected = true;
    mediaFailure.value = false;
    connectivity.online = true;
    currentPermissions.value = ["messages.send", "messages.attachments.upload"];
  });

  it("rejects malformed conversation route IDs before any room join is attempted", () => {
    expect(parseConversationRouteId(undefined)).toBeNull();
    expect(parseConversationRouteId("")).toBeNull();
    expect(parseConversationRouteId("0")).toBeNull();
    expect(parseConversationRouteId("-1")).toBeNull();
    expect(parseConversationRouteId("1.5")).toBeNull();
    expect(parseConversationRouteId("101x")).toBeNull();
    expect(parseConversationRouteId("101")).toBe(101);
  });

  it("uses the shared socket and deterministically removes conversation listeners on unmount", async () => {
    const rendered = renderMessages();
    await waitFor(() => {
      expect(sharedSocket.on).toHaveBeenCalledWith("conversation:changed", expect.any(Function));
      expect(sharedSocket.on).toHaveBeenCalledWith("conversation:personal", expect.any(Function));
      expect(sharedSocket.emit).toHaveBeenCalledWith(
        "conversation:join",
        { conversationId: 101 },
        expect.any(Function),
      );
    });

    rendered.unmount();

    expect(sharedSocket.off).toHaveBeenCalledWith("conversation:changed", expect.any(Function));
    expect(sharedSocket.off).toHaveBeenCalledWith("conversation:personal", expect.any(Function));
    expect(sharedSocket.emit).toHaveBeenCalledWith(
      "conversation:leave",
      { conversationId: 101 },
    );
  });

  it("fetches message history without reusing stale browser-cache entries after a send", async () => {
    renderMessages();

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/conversations/101/messages?limit=80",
        expect.objectContaining({ credentials: "include", cache: "no-store" }),
      );
    });
  });

  it("merges paged history chronologically without duplicate ids during a realtime refetch", () => {
    const messages = mergeMessageHistory([
      {
        items: [
          { id: 20, createdAt: "2026-08-19T10:20:00.000Z", reactions: [] },
          { id: 30, createdAt: "2026-08-19T10:30:00.000Z", reactions: [] },
        ],
        hasMore: true,
        nextCursor: "older-page",
      },
      {
        items: [
          { id: 10, createdAt: "2026-08-19T10:10:00.000Z", reactions: [] },
          { id: 20, createdAt: "2026-08-19T10:20:00.000Z", reactions: [{ emoji: "👍", userId: 7, userName: "Messaging User" }] },
        ],
        hasMore: false,
        nextCursor: null,
      },
    ] as never);

    expect(messages.map((message) => message.id)).toEqual([10, 20, 30]);
    expect(messages.find((message) => message.id === 20)?.reactions).toEqual([]);
  });

  it("merges paged conversation results without duplicate rows during a realtime refetch", () => {
    const conversations = mergeConversationPages([
      {
        items: [{ id: 20, type: "group", name: "Health", unreadCount: 1 }],
        hasMore: true,
        nextCursor: "older-page",
      },
      {
        items: [{ id: 10, type: "group", name: "Finance", unreadCount: 0 }, { id: 20, type: "group", name: "Health", unreadCount: 0 }],
        hasMore: false,
        nextCursor: null,
      },
    ] as never);

    expect(conversations.map((conversation) => conversation.id)).toEqual([20, 10]);
    expect(conversations.find((conversation) => conversation.id === 20)?.unreadCount).toBe(0);
  });

  it("does not render an unsupported delivered or seen receipt claim for sender messages", async () => {
    const { readFile } = await import("node:fs/promises");
    const { resolve } = await import("node:path");
    const source = await readFile(resolve(process.cwd(), "src/pages/messages.tsx"), "utf8");

    expect(source).not.toContain("CheckCheck");
    expect(source).not.toMatch(/aria-label=.*(?:seen|delivered)/i);
  });

  it("shows attachment and voice controls for a user with the messaging upload capability", async () => {
    currentPermissions.value = ["messages.send", "messages.attachments.upload"];
    renderMessages();

    await waitFor(() => {
      expect(screen.getByLabelText("attachFile")).toBeInTheDocument();
      expect(screen.getByLabelText("recordVoice")).toBeInTheDocument();
      expect(screen.getByLabelText("insertEmoji")).toBeInTheDocument();
      expect(screen.getByLabelText("typeMessage")).toBeInTheDocument();
    });
  });

  it("hides attachment and voice controls for a text-only messaging user", async () => {
    currentPermissions.value = ["messages.send"];
    renderMessages();

    await waitFor(() => expect(screen.getByPlaceholderText("typeMessagePlaceholder")).toBeInTheDocument());
    expect(screen.queryByLabelText("attachFile")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("recordVoice")).not.toBeInTheDocument();
  });

  it("keeps binary attachments online-only and makes the blocked state visible", async () => {
    connectivity.online = false;
    renderMessages();

    const attach = await screen.findByLabelText("attachFile");
    const voice = screen.getByLabelText("recordVoice");
    expect(attach).toBeDisabled();
    expect(voice).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("attachmentOnlineRequired");

    const fileInput = document.querySelector('input[type="file"]')!;
    vi.mocked(global.fetch).mockClear();
    fireEvent.change(fileInput, {
      target: { files: [new File(["offline"], "offline.pdf", { type: "application/pdf" })] },
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("keeps media and message actions keyboard-operable with translated names", async () => {
    currentPermissions.value = ["messages.send", "messages.attachments.upload"];
    renderMessages();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "openImage" })).toBeInTheDocument();
      expect(screen.getByLabelText("addReaction")).toBeInTheDocument();
      expect(screen.getByLabelText("messageOptions")).toBeInTheDocument();
    });
  });

  it("renders a compact composer with a disabled-until-ready send action", async () => {
    currentPermissions.value = ["messages.send", "messages.attachments.upload"];
    renderMessages();

    const composer = await screen.findByLabelText("typeMessage");
    const send = screen.getByLabelText("sendMessage");
    expect(send).toBeDisabled();

    fireEvent.change(composer, { target: { value: "Ready to send" } });
    expect(send).toBeEnabled();
  });

  it("renders the media browser as a complete keyboard tab pattern", async () => {
    renderMessages();
    await waitFor(() => expect(screen.getByLabelText("mediaGallery")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("mediaGallery"));

    const tablist = await screen.findByRole("tablist", { name: "mediaGallery" });
    const tabs = screen.getAllByRole("tab");
    expect(tablist).toBeInTheDocument();
    expect(tabs).toHaveLength(3);
    expect(tabs[0]).toHaveAttribute("aria-controls", "media-tabpanel-photos");
    expect(tabs[0]).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", "media-tab-photos");

    fireEvent.keyDown(tabs[0], { key: "ArrowRight" });
    await waitFor(() => expect(tabs[1]).toHaveAttribute("aria-selected", "true"));
    expect(tabs[1]).toHaveAttribute("tabindex", "0");
    await waitFor(() => expect(tabs[1]).toHaveFocus());
    expect(screen.getByRole("tabpanel")).toHaveAttribute("id", "media-tabpanel-docs");
  });

  it("renders a retryable media error instead of a blank auxiliary panel", async () => {
    mediaFailure.value = true;
    renderMessages();
    fireEvent.click(await screen.findByLabelText("mediaGallery"));

    expect(await screen.findByText("errLoadMedia")).toBeInTheDocument();
    const retry = screen.getByRole("button", { name: "retry" });
    expect(retry).toBeEnabled();
    fireEvent.click(retry);
    expect(global.fetch).toHaveBeenCalledWith("/api/conversations/101/media", expect.objectContaining({ credentials: "include" }));
  });

  it("keeps the new-conversation dialog footer reachable in the rendered flow", async () => {
    renderMessages();
    fireEvent.click(await screen.findByRole("button", { name: "newChat" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "cancel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "startConversation" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "typeLabel" })).toBeInTheDocument();
  });
});