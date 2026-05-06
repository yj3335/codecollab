import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "./App";
import { ApiError } from "./lib/api";

const mockRun = jest.fn();
const mockClear = jest.fn();
const mockRerun = jest.fn();
const mockPatchSessionLanguage = jest.fn();
const mockPostTranslate = jest.fn();
const mockGetSession = jest.fn();
const mockCreateSession = jest.fn();

const mockSessionHookState = {
  activeSessionId: "s-123",
  createError: null as string | null,
  clearCreateError: jest.fn(),
  isCreatingSession: false,
  onCreateSession: jest.fn(),
  onCopyShareUrl: jest.fn(),
  shareUrl: "http://localhost:3000/s/s-123",
};

let mockEditorValue = "print('ok')";
let mockApplyCode = jest.fn();

jest.mock("./hooks/useSession", () => ({
  useSession: () => mockSessionHookState,
}));

jest.mock("./hooks/useExecution", () => ({
  useExecution: () => ({
    lines: [],
    running: false,
    error: null,
    errorKind: null,
    run: mockRun,
    clear: mockClear,
    rerun: mockRerun,
  }),
}));

jest.mock("./lib/api", () => {
  const actual = jest.requireActual("./lib/api");
  return {
    ...actual,
    createSession: (...args: unknown[]) => mockCreateSession(...args),
    getSession: (...args: unknown[]) => mockGetSession(...args),
    patchSessionLanguage: (...args: unknown[]) => mockPatchSessionLanguage(...args),
    postTranslate: (...args: unknown[]) => mockPostTranslate(...args),
  };
});

jest.mock("./components/EditorPanel", () => {
  const React = require("react");
  return {
    EditorPanel: React.forwardRef((props: any, ref: any) => {
      React.useImperativeHandle(ref, () => ({
        getCode: () => mockEditorValue,
        applyCode: mockApplyCode,
      }));
      return (
        <section>
          <button onClick={() => props.onRunRequest?.(mockEditorValue)}>RunMock</button>
          <button onClick={() => props.onTranslateRequest?.(mockEditorValue)}>TranslateMock</button>
        </section>
      );
    }),
  };
});

function renderApp(path = "/s/s-123") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>
  );
}

describe("App Week3 UX", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSessionHookState.createError = null;
    mockEditorValue = "print('ok')";
    mockApplyCode = jest.fn();
    mockGetSession.mockResolvedValue({
      sessionId: "s-123",
      language: "python",
    });
  });

  it("shows session-not-found page on 404", async () => {
    mockGetSession.mockRejectedValue(new ApiError("Not found", "not_found", 404));
    renderApp();
    expect(await screen.findByText("Session not found")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create new session" })).toBeInTheDocument();
  });

  it("shows empty-editor banner when run is clicked without code", async () => {
    mockEditorValue = "   ";
    renderApp();
    fireEvent.click(await screen.findByText("RunMock"));
    expect(
      await screen.findByText("Editor is empty. Add code before running.")
    ).toBeInTheDocument();
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("opens translation diff and accepts translation", async () => {
    mockPostTranslate.mockResolvedValue({
      id: "t1",
      sessionId: "s-123",
      sourceLanguage: "python",
      targetLanguage: "javascript",
      originalCode: "print('ok')",
      translatedCode: "console.log('ok')",
      explanation: "mock",
      timestamp: "now",
    });
    mockPatchSessionLanguage.mockResolvedValue({
      sessionId: "s-123",
      language: "javascript",
    });

    renderApp();
    fireEvent.click(await screen.findByText("TranslateMock"));
    expect(await screen.findByText("Translation")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));

    await waitFor(() =>
      expect(mockPatchSessionLanguage).toHaveBeenCalledWith("s-123", "javascript")
    );
    expect(mockApplyCode).toHaveBeenCalledWith("console.log('ok')");
  });

  it("dismisses translation diff", async () => {
    mockPostTranslate.mockResolvedValue({
      id: "t1",
      sessionId: "s-123",
      sourceLanguage: "python",
      targetLanguage: "javascript",
      originalCode: "print('ok')",
      translatedCode: "console.log('ok')",
      explanation: "mock",
      timestamp: "now",
    });
    renderApp();
    fireEvent.click(await screen.findByText("TranslateMock"));
    expect(await screen.findByText("Translation")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    });
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Accept" })).not.toBeInTheDocument()
    );
  });
});
