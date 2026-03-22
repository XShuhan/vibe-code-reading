import type { CodeThreadMapping } from "@code-vibe/shared";

import { BaseJsonStore } from "./baseJsonStore";

export class CodeThreadMappingStore extends BaseJsonStore<CodeThreadMapping[]> {
  constructor(filePath: string) {
    super(filePath, []);
  }
}
