import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError, createSession } from "../lib/api";

export function useSession(routeSessionId: string) {
  const navigate = useNavigate();
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const activeSessionId = routeSessionId || crypto.randomUUID();
  const shareUrl = useMemo(
    () => `${window.location.origin}/s/${activeSessionId}`,
    [activeSessionId]
  );

  const onCreateSession = async (language?: string) => {
    setIsCreatingSession(true);
    setCreateError(null);
    try {
      const nextId = await createSession(language ? { language } : undefined);
      navigate(`/s/${nextId}`);
    } catch (error) {
      console.error("createSession failed:", error);
      const message =
        error instanceof ApiError
          ? error.message
          : "Unable to create session right now. Please try again.";
      setCreateError(message);
    } finally {
      setIsCreatingSession(false);
    }
  };

  const onCopyShareUrl = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
    } catch {
      // Clipboard may be blocked in non-secure contexts; surface failure via banner if needed.
    }
  };

  return {
    activeSessionId,
    createError,
    isCreatingSession,
    onCreateSession,
    onCopyShareUrl,
    shareUrl,
    clearCreateError: () => setCreateError(null),
  };
}
