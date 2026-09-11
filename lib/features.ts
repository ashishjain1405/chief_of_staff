// Commitment extraction looks for promises the user made, and those live in
// sent mail. Nothing ingests sent mail yet — the Gmail watch subscribes to
// INBOX only and both ingest paths hardcode direction: "inbound" — so the
// commitments table is structurally empty rather than broken.
//
// Hidden behind a flag instead of deleted: the extraction, ranking, insight
// and UI code all work. Reviving the feature is one ingestion change, so
// flipping this back to true is the last step, not the first.
export const FEATURES: { commitments: boolean } = {
  commitments: false,
};
