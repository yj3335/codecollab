import { act, renderHook } from "@testing-library/react";
import { useYjs } from "./useYjs";

const mockDestroyCalls: number[] = [];
const mockConstructed: Array<{ url: string; room: string }> = [];

jest.mock("y-websocket", () => ({
  WebsocketProvider: function (this: any, url: string, room: string) {
    mockConstructed.push({ url, room });
    this.on = jest.fn();
    this.off = jest.fn();
    this.destroy = () => {
      mockDestroyCalls.push(Date.now());
    };
    this.awareness = { setLocalStateField: jest.fn() };
  },
}));

jest.mock("y-monaco", () => ({
  MonacoBinding: jest.fn(),
}));

jest.mock("yjs", () => ({
  Doc: function (this: any) {
    this.getText = () => ({ toString: () => "" });
    this.destroy = jest.fn();
  },
  UndoManager: jest.fn(),
}));

jest.mock("../lib/userIdentity", () => ({
  colorFromString: () => "hsl(0 0% 0%)",
  getDisplayName: () => "Test",
  getOrCreateOwnerId: () => "owner-id",
}));

describe("useYjs", () => {
  beforeEach(() => {
    mockConstructed.length = 0;
    mockDestroyCalls.length = 0;
  });

  it("does not rebuild the WebsocketProvider when onStatusChange identity changes", () => {
    const { rerender } = renderHook(
      ({ onStatusChange }: { onStatusChange?: (status: string) => void }) =>
        useYjs({
          sessionId: "abc",
          wsUrl: "wss://example.test/ws",
          onStatusChange: onStatusChange as never,
        }),
      {
        initialProps: { onStatusChange: () => {} },
      }
    );

    expect(mockConstructed).toHaveLength(1);

    act(() => {
      rerender({ onStatusChange: () => {} });
      rerender({ onStatusChange: () => {} });
      rerender({ onStatusChange: () => {} });
    });

    expect(mockConstructed).toHaveLength(1);
    expect(mockDestroyCalls).toHaveLength(0);
  });

  it("rebuilds the WebsocketProvider when sessionId or wsUrl changes", () => {
    const { rerender } = renderHook(
      ({ sessionId, wsUrl }: { sessionId: string; wsUrl: string }) =>
        useYjs({ sessionId, wsUrl, onStatusChange: () => {} }),
      {
        initialProps: { sessionId: "abc", wsUrl: "wss://example.test/ws" },
      }
    );

    expect(mockConstructed).toHaveLength(1);

    act(() => {
      rerender({ sessionId: "def", wsUrl: "wss://example.test/ws" });
    });

    expect(mockConstructed).toHaveLength(2);
    expect(mockDestroyCalls).toHaveLength(1);
  });
});
