import { authenticate, requireResource } from "./auth.ts";
import { ServiceFault } from "./errors.ts";
import type { Context } from "./domain.ts";
import type { Ref } from "../../contracts/src/index.ts";
import type { Store } from "./store.ts";
interface Document {
  title: string;
  text: string;
  source_refs: Ref[];
}
export class KnowledgeFault extends Error {}
export class KnowledgeReader {
  private readonly store: Store;
  private readonly now: () => number;
  constructor(store: Store, now: () => number = Date.now) {
    this.store = store;
    this.now = now;
  }
  private document(ctx: Context, id: string) {
    const r = requireResource<Document>(
      this.store,
      ctx,
      id,
      "knowledge_document",
    );
    if (
      typeof r.data.title !== "string" ||
      typeof r.data.text !== "string" ||
      r.data.title.length > 256 ||
      r.data.text.length > 1000000 ||
      !Array.isArray(r.data.source_refs) ||
      r.data.source_refs.length === 0 ||
      r.data.source_refs.length > 128
    )
      throw new KnowledgeFault("KNOWLEDGE_CONTRACT");
    for (const ref of r.data.source_refs) {
      if (
        !ref ||
        typeof ref.id !== "string" ||
        typeof ref.revision !== "string"
      )
        throw new KnowledgeFault("KNOWLEDGE_CONTRACT");
      if (requireResource(this.store, ctx, ref.id).revision !== ref.revision)
        throw new KnowledgeFault("KNOWLEDGE_STALE");
    }
    return {
      id: r.id,
      revision: r.revision,
      title: r.data.title,
      text: r.data.text,
      source_refs: r.data.source_refs,
    };
  }
  read(token: string, projectId: string, id: string) {
    return this.document(
      authenticate(this.store, token, projectId, "knowledge_read", this.now()),
      id,
    );
  }
  search(token: string, projectId: string, query: string, limit = 20) {
    const ctx = authenticate(
      this.store,
      token,
      projectId,
      "knowledge_read",
      this.now(),
    );
    if (
      typeof query !== "string" ||
      query.trim().length === 0 ||
      query.length > 256 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 50
    )
      throw new KnowledgeFault("KNOWLEDGE_CONTRACT");
    const terms = [
      ...new Set(query.trim().toLocaleLowerCase("en").split(/\s+/u)),
    ];
    const rows = [];
    for (const id of new Set(ctx.grant.resource_ids)) {
      if (!ctx.policy.resource_ids.includes(id)) continue;
      const r = this.store.getResource(id);
      if (!r || r.kind !== "knowledge_document") continue;
      let doc;
      try {
        doc = this.document(ctx, id);
      } catch (e) {
        if (
          (e instanceof ServiceFault && e.code === "NOT_FOUND_OR_DENIED") ||
          (e instanceof KnowledgeFault && e.message === "KNOWLEDGE_STALE")
        )
          continue;
        throw e;
      }
      const text = (doc.title + "\n" + doc.text).toLocaleLowerCase("en");
      const score = terms.filter((t) => text.includes(t)).length;
      if (score !== terms.length) continue;
      rows.push({ ...doc, excerpt: doc.text.slice(0, 320), score });
    }
    return rows
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
      .slice(0, limit)
      .map(({ text: _, score: __, ...row }) => row);
  }
}
