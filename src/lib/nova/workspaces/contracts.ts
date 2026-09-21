export function declareWorkspaceArtifact(project_id: string, kind: string, title: string) {
  return { id: crypto.randomUUID(), project_id, kind, title, memory_state: "draft" };
}
export function relateWorkspaceArtifacts(a: {project_id:string; id:string}, b: {project_id:string; id:string}, relation_kind:string) {
  if (a.project_id !== b.project_id) throw new Error("Cross-project workspace relation denied");
  return { project_id:a.project_id, from_artifact_id:a.id, to_artifact_id:b.id, relation_kind };
}
export function resolveWorkspaceEngineAdapters(flags: Record<string,boolean>) {
  return {
    epublisher:{capability_id:"capability.content.publish",state:flags.epublisher?"verified":"degraded"},
    creative_studio:{capability_id:"capability.media.generate",state:flags.creative_studio?"verified":"degraded"},
    sync_vision:{capability_id:"capability.vision.sync",state:flags.sync_vision?"verified":"degraded"},
    local_stt:{capability_id:"capability.audio.transcribe",state:flags.local_stt?"verified":"degraded"},
    local_image:{capability_id:"capability.image.generate",state:flags.local_image?"verified":"degraded"},
    musetalk:{capability_id:"capability.video.lipsync",state:flags.musetalk?"verified":"degraded"},
  };
}
