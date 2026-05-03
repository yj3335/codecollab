import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createSession } from "../lib/api";

export function useSession(routeSessionId: string) {
  const navigate = useNavigate();
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const activeSessionId = routeSessionId || crypto.randomUUID();
  const shareUrl = useMemo(
    () => `${window.location.origin}/s/${activeSessionId}`,
    [activeSessionId]
  );

  const onCreateSession = async () => {
    setIsCreatingSession(true);
    try {
      const nextId = await createSession();
      navigate(`/s/${nextId}`);
    } catch (error) {
      console.error("createSession failed:", error);
    } finally {
      setIsCreatingSession(false);
    }
  };

  const onCopyShareUrl = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
    } catch (error) {
      // Clipboard may be blocked in non-secure contexts.
    }
  };

  return {
    activeSessionId,
    isCreatingSession,
    onCreateSession,
    onCopyShareUrl,
    shareUrl,
  };
}
