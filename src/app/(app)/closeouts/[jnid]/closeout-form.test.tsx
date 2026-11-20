import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { checklistFor, CLOSEOUT_PACKAGE_PHOTO_LIMIT } from "@/domain/closeouts";

vi.mock("../actions", () => ({
  saveCloseout: vi.fn(async (state: unknown) => state),
  clearSignoff: vi.fn(),
}));

const { CloseoutForm } = await import("./closeout-form");

function props(overrides: Partial<Parameters<typeof CloseoutForm>[0]> = {}): Parameters<typeof CloseoutForm>[0] {
  return {
    closeout: {
      id: "6b1f9a4e-1d5c-4c8e-9a51-0f0e7a1c2d3b",
      version: 4,
      jobJnid: "job-1",
      installStartedOn: "2026-11-18",
      installCompletedOn: "2026-11-18",
      crew: null,
      squaresInstalled: null,
      layersRemoved: null,
      deckingSheetsReplaced: null,
      checklist: {},
      punchItems: null,
      productionNotes: null,
      featureNote: null,
      selectedPhotoJnids: [],
      homeownerUnavailableReason: null,
      photosStatus: "ready",
    },
    signoff: null,
    suggestions: { installDays: "Nov 18, 2026", squares: null },
    checklist: checklistFor("Roof & RR").map(({ key, label }) => ({ key, label })),
    photos: Array.from({ length: CLOSEOUT_PACKAGE_PHOTO_LIMIT + 2 }, (_, index) => ({
      fileJnid: `file-${index}`,
      thumbUrl: `https://storage.example.com/thumb-${index}.webp`,
      takenAt: "2026-11-18T15:00:00Z",
      outcome: "ready",
    })),
    initialGaps: ["Answer 12 checklist items"],
    ...overrides,
  };
}

test("prefills install dates and shows where the suggestion came from", () => {
  render(<CloseoutForm {...props()} />);
  expect(screen.getByLabelText("Started")).toHaveValue("2026-11-18");
  expect(screen.getByText("Suggested from the crew's photos: Nov 18, 2026.")).toBeInTheDocument();
  expect(screen.getByText("Solar panels reinstalled and producing")).toBeInTheDocument();
  expect(screen.getByText(/Before submitting: Answer 12 checklist items/)).toBeInTheDocument();
});

test("stops photo picks at the package limit", () => {
  render(<CloseoutForm {...props()} />);
  const boxes = screen.getAllByRole("checkbox");
  for (const box of boxes.slice(0, CLOSEOUT_PACKAGE_PHOTO_LIMIT)) fireEvent.click(box);
  expect(screen.getByText(`${CLOSEOUT_PACKAGE_PHOTO_LIMIT} of ${CLOSEOUT_PACKAGE_PHOTO_LIMIT} picked`)).toBeInTheDocument();
  expect(boxes[CLOSEOUT_PACKAGE_PHOTO_LIMIT]).toBeDisabled();
  fireEvent.click(boxes[0]);
  expect(boxes[CLOSEOUT_PACKAGE_PHOTO_LIMIT]).toBeEnabled();
});

test("locks what the homeowner signed and offers to clear it", () => {
  render(
    <CloseoutForm
      {...props({
        signoff: { name: "Dana Whitfield", signedAt: "2026-11-18T21:00:00Z", photoRelease: "granted", reviewRequestOk: false, outcome: "complete" },
      })}
    />,
  );
  expect(screen.getByLabelText("Finished")).toHaveAttribute("readonly");
  expect(screen.getByLabelText("Open items the homeowner should know about")).toHaveAttribute("readonly");
  const signoff = screen.getByRole("heading", { name: "Homeowner sign-off" }).closest("section") as HTMLElement;
  expect(within(signoff).getByText(/Signed by Dana Whitfield/)).toBeInTheDocument();
  expect(within(signoff).getByText(/Photos allowed · Review link declined/)).toBeInTheDocument();
  expect(within(signoff).getByRole("button", { name: "Clear sign-off" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Save and hand to homeowner" })).not.toBeInTheDocument();
});

test("says photos are still on their way from JobNimbus", () => {
  render(<CloseoutForm {...props({ photos: [], closeout: { ...props().closeout, photosStatus: "preparing" } })} />);
  expect(screen.getByText(/Copying the crew's photos from JobNimbus/)).toBeInTheDocument();
});
