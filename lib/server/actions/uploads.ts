"use server";

import type { ActionResult } from "@/lib/action-result";
import type { UploadStatus } from "@/lib/types";
import { uploadIdSchema, uploadRequestSchema } from "@/lib/validation/upload";
import { requireActor } from "../auth";
import { parseInput, runAction } from "../run-action";
import { confirmUpload, requestUpload, uploadStatus } from "../services/uploads";

// B09 (backend plan 11.1): the photo picker calls these directly (not as form posts). The file itself never passes
// through the app: the browser sends it straight to storage with the address from requestUploadAction.

/** Where to PUT the file and which headers to send with it. */
export type UploadTicket = ActionResult & { uploadId?: string; url?: string; headers?: Record<string, string> };

/** Where an upload stands; `reason` says why a REJECTED one was refused. */
export type UploadState = ActionResult & { status?: UploadStatus; reason?: string };

export async function requestUploadAction(input: unknown): Promise<UploadTicket> {
  return runAction<UploadTicket>(async () => {
    const actor = await requireActor();
    const ticket = await requestUpload(actor, parseInput(uploadRequestSchema, input));
    return { ok: true, ...ticket };
  });
}

export async function confirmUploadAction(input: unknown): Promise<UploadState> {
  return runAction<UploadState>(async () => {
    const actor = await requireActor();
    const upload = await confirmUpload(actor, parseInput(uploadIdSchema, input).uploadId);
    return { ok: true, status: upload.status, reason: upload.rejectReason };
  });
}

export async function uploadStatusAction(input: unknown): Promise<UploadState> {
  return runAction<UploadState>(async () => {
    const actor = await requireActor();
    const upload = await uploadStatus(actor, parseInput(uploadIdSchema, input).uploadId);
    return { ok: true, status: upload.status, reason: upload.rejectReason };
  });
}
