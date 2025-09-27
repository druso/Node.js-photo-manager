import { useCallback, useState } from 'react';

const normalizeProject = (project) => {
  if (!project || !project.folder) return null;
  return { folder: project.folder, name: project.name || '' };
};

export default function useAllPhotosUploads({ onProjectChosen, onProjectCreate } = {}) {
  const [pendingFiles, setPendingFiles] = useState(null);
  const [pendingUpload, setPendingUpload] = useState(null);
  const [showProjectSelection, setShowProjectSelection] = useState(false);
  const [initialProject, setInitialProject] = useState(null);
  const [activeProject, setActiveProject] = useState(null);

  const registerActiveProject = useCallback((project) => {
    setActiveProject((prev) => {
      const normalized = normalizeProject(project);
      const prevFolder = prev?.folder || '';
      const nextFolder = normalized?.folder || '';
      if (!normalized && !prev) return prev;
      if (prevFolder === nextFolder) {
        const prevName = prev?.name || '';
        const nextName = normalized?.name || '';
        if (prevName === nextName) {
          return prev;
        }
      }
      return normalized;
    });
  }, []);

  const openProjectSelection = useCallback((files, presetProject = null) => {
    if (!files || (typeof files.length === 'number' && files.length === 0)) return;
    setPendingFiles(Array.from(files));
    setPendingUpload(null);
    const normalizedPreset = normalizeProject(presetProject);
    setInitialProject(normalizedPreset || activeProject || null);
    setShowProjectSelection(true);
  }, [activeProject]);

  const handleFilesDroppedInAllView = useCallback((files) => {
    openProjectSelection(files);
  }, [openProjectSelection]);

  const handleProjectSelection = useCallback(async (project, meta = {}) => {
    setShowProjectSelection(false);

    if (!pendingFiles) {
      setPendingFiles(null);
      setInitialProject(null);
      return;
    }

    let targetProject = normalizeProject(project);

    if (meta.mode === 'create') {
      const desiredName = (project?.name || project?.folder || '').trim();
      if (!desiredName || typeof onProjectCreate !== 'function') {
        setPendingFiles(null);
        setInitialProject(null);
        return;
      }
      const created = await onProjectCreate(desiredName);
      if (!created?.folder) {
        setPendingFiles(null);
        setInitialProject(null);
        return;
      }
      targetProject = normalizeProject({ folder: created.folder, name: created.name || desiredName });
    }

    if (!targetProject?.folder) {
      setPendingFiles(null);
      setInitialProject(null);
      return;
    }

    registerActiveProject(targetProject);

    let nextUpload = null;
    if (typeof onProjectChosen === 'function') {
      const result = onProjectChosen(targetProject, pendingFiles);
      if (result && result.files && result.targetProject) {
        nextUpload = {
          ...result,
          files: result.files,
          targetProject: normalizeProject(result.targetProject) || targetProject,
        };
      }
    }

    if (!nextUpload) {
      nextUpload = { files: pendingFiles, targetProject };
    } else if (!nextUpload.files) {
      nextUpload = { ...nextUpload, files: pendingFiles };
    }

    setPendingUpload(nextUpload);
    setPendingFiles(null);
    setInitialProject(targetProject);
  }, [pendingFiles, onProjectChosen, onProjectCreate, registerActiveProject]);

  const handleProjectSelectionCancel = useCallback(() => {
    setShowProjectSelection(false);
    setPendingFiles(null);
    setInitialProject(null);
  }, []);

  const clearPendingUpload = useCallback(() => {
    setPendingUpload(null);
  }, []);

  return {
    pendingUpload,
    showProjectSelection,
    initialProject: initialProject || activeProject,
    handleFilesDroppedInAllView,
    handleProjectSelection,
    handleProjectSelectionCancel,
    clearPendingUpload,
    openProjectSelection,
    registerActiveProject,
  };
}
