/**
 * Publishing one run's artifacts.
 *
 * Every document is published whole or not at all, and never over an existing path:
 * the write stages a complete file in a fresh directory inside the run root and links
 * it into place, which fails rather than truncating when the destination appeared
 * meanwhile. Reports are raw producer documents, so they are published through the
 * narrow raw-document primitive rather than through the evaluator's decision
 * publisher: a raw report is not a decision and must never be labelled as one.
 */

import { publishDocumentNoReplace, serializeForPublication } from '../publication.js';
import type { RunRoot } from './runRoot.js';

export interface RunArtifact {
  /** One plain file name inside the run root. */
  readonly name: string;
  readonly document: unknown;
  /** Where the file belongs: the run root, or the reports directory the evaluator reads. */
  readonly area?: 'root' | 'reports';
}

export interface ArtifactPublication {
  readonly published: readonly string[];
  readonly problems: readonly string[];
}

/**
 * Publish a set of artifacts.
 *
 * Each document is serialized before anything is created, so a document that cannot
 * be serialized is reported without leaving a staging directory behind. A failure
 * stops the remaining publications: the run is already an instrument failure, and
 * writing more of its artifacts would make the partial set look deliberate.
 */
export function publishRunArtifacts(root: RunRoot, artifacts: readonly RunArtifact[]): ArtifactPublication {
  const published: string[] = [];
  const problems: string[] = [];
  for (const artifact of artifacts) {
    let bytes: string;
    try {
      bytes = serializeForPublication(artifact.document);
    } catch (error) {
      problems.push(`cannot serialize ${artifact.name}: ${error instanceof Error ? error.message : String(error)}`);
      break;
    }
    let path: string;
    try {
      path = artifact.area === 'reports' ? root.reportPath(artifact.name) : root.artifactPath(artifact.name);
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error));
      break;
    }
    const result = publishDocumentNoReplace(path, bytes);
    if (!result.ok) {
      problems.push(result.problem);
      break;
    }
    published.push(artifact.name);
  }
  return { published, problems };
}
