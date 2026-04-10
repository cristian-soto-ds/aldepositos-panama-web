"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  supabase,
  insertTask,
  insertTasks,
  updateTask,
  deleteTaskById,
} from "@/lib/supabase";
import { useSupabaseTasks } from "@/hooks/useSupabaseTasks";
import type { Task } from "@/lib/types/task";
import { ControlPanelLayout } from "@/components/layout/ControlPanelLayout";
import { ControlPanelHome } from "@/components/control-panel/ControlPanelHome";
import { QuickInventoryEntry } from "@/components/control-panel/QuickInventoryEntry";
import { DetailedInventoryEntry } from "@/components/control-panel/DetailedInventoryEntry";
import { CompletedReportsModule } from "@/components/control-panel/CompletedReportsModule";
import { LiveMonitor } from "@/components/control-panel/LiveMonitor";
import { DispatchEntry } from "@/components/control-panel/DispatchEntry";
import { ContainerReportsModule } from "@/components/control-panel/ContainerReportsModule";
import { ProductivityInsightsPanel } from "@/components/control-panel/ProductivityInsightsPanel";
import { ReferenceCatalogModule } from "@/components/control-panel/ReferenceCatalogModule";
import { CollectionOrderModule } from "@/components/control-panel/CollectionOrderModule";
import { UserOptionsPanel } from "@/components/control-panel/UserOptionsPanel";
import { ManualEntryModal } from "@/components/modals/ManualEntryModal";
import { DeleteRaConfirmModal } from "@/components/modals/DeleteRaConfirmModal";
import { adaptMeasureDataForModule } from "@/lib/taskUtils";
import {
  DEFAULT_USER_PREFERENCES,
  sanitizeUserPreferences,
  userPrefsStorageKey,
  type UserPreferences,
} from "@/lib/userPreferences";
import {
  clearWorkPresence,
  getSharedWorkPresenceTabId,
  publishWorkPresence,
} from "@/lib/panelPresence";
import { isPublicAvatarUrl } from "@/lib/profileAvatar";
import { fetchPerfilUsuario } from "@/lib/perfiles";
import { presenceVisibleLabel } from "@/lib/viewerIdentity";
import { withTaskContribution } from "@/lib/taskContributions";

/** Vistas donde la tabla debe usar toda la altura del main (scroll solo dentro del módulo). */
const FULL_HEIGHT_INVENTORY_VIEWS = new Set([
  "quick-entry",
  "detailed-entry",
  "airway",
  "collection-orders",
]);

export default function PanelPage() {
  const router = useRouter();
  const showOptionsModule = true;
  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userDisplayName, setUserDisplayName] = useState<string | null>(null);
  /** `perfiles.nombre_completo` en Supabase (ej. "Cristian Soto"); prioridad explícita en el saludo. */
  const [profileFullName, setProfileFullName] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<UserPreferences>(
    DEFAULT_USER_PREFERENCES,
  );
  const [loading, setLoading] = useState(true);
  const [currentView, setCurrentView] = useState("dashboard");
  const { tasks, setTasks, reloadTasks, tasksLoading } = useSupabaseTasks({
    enabled: !!userEmail,
  });
  const [containerToEdit, setContainerToEdit] = useState<{
    loadedIds: string[];
    containerInfo: {
      type: string;
      consignment: string;
      number: string;
      bl: string;
      seal1: string;
      seal2: string;
      responsible: string;
      date: string;
    };
  } | null>(null);
  const [modalState, setModalState] = useState<{
    isOpen: boolean;
    editingTask: Task | null;
    defaultModule: "quick" | "detailed" | "airway";
  }>({
    isOpen: false,
    editingTask: null,
    defaultModule: "quick",
  });
  const [deleteRaId, setDeleteRaId] = useState<string | null>(null);
  const [deleteRaBusy, setDeleteRaBusy] = useState(false);
  /** URL pública guardada en `perfiles.avatar_url` (Supabase). */
  const [profileAvatarUrl, setProfileAvatarUrl] = useState<string | null>(null);

  useEffect(() => {
    const checkSession = async () => {
      const { data } = await supabase.auth.getUser();
      const user = data.user;
      if (!user) {
        router.replace("/login");
      } else {
        setUserId(user.id);
        const email = user.email ?? null;
        setUserEmail(email);

        const meta = user.user_metadata as Record<string, unknown> | undefined;
        const metaRaw = meta?.full_name ?? meta?.name ?? meta?.nombre_completo;
        const metaFullName =
          typeof metaRaw === "string" ? metaRaw.trim() : "";

        const { data: sessionData } = await supabase.auth.getSession();
        const accessToken = sessionData.session?.access_token;

        const perfil = await fetchPerfilUsuario(user.id, email);
        let fullName = perfil.nombreCompleto || metaFullName;
        let avatarUrl = perfil.avatarUrl;

        if (accessToken && typeof window !== "undefined") {
          try {
            const res = await fetch(
              `${window.location.origin}/api/me/display-name`,
              { headers: { Authorization: `Bearer ${accessToken}` } },
            );
            if (res.ok) {
              const payload = (await res.json()) as {
                fullName?: string | null;
                avatarUrl?: string | null;
              };
              const fromServer = payload.fullName?.trim();
              if (fromServer) fullName = fullName || fromServer;
              const av = payload.avatarUrl?.trim();
              if (av) avatarUrl = avatarUrl || av;
            }
          } catch {
            /* ignorar: sin service role o red */
          }
        }

        setProfileFullName(fullName ? fullName : null);

        /** Solo `nombre_completo` (o equivalente en metadata); nunca correo ni `nombre_usuario` suelto. */
        const humanLabel =
          (fullName || metaFullName || "Operador Aldepósitos").trim() ||
          "Operador Aldepósitos";
        setUserDisplayName(humanLabel);

        setProfileAvatarUrl(avatarUrl);
        const serverAvatar = avatarUrl;

        if (typeof window !== "undefined") {
          const raw = window.localStorage.getItem(userPrefsStorageKey(user.id));
          let nextPrefs = DEFAULT_USER_PREFERENCES;
          if (raw) {
            try {
              nextPrefs = sanitizeUserPreferences(JSON.parse(raw));
            } catch {
              nextPrefs = DEFAULT_USER_PREFERENCES;
            }
          }
          if (serverAvatar) {
            nextPrefs = { ...nextPrefs, avatarDataUrl: serverAvatar };
          }
          setPreferences(nextPrefs);
        }
      }
      setLoading(false);
    };
    checkSession();
  }, [router]);

  useEffect(() => {
    if (!userId || typeof window === "undefined") return;
    window.localStorage.setItem(
      userPrefsStorageKey(userId),
      JSON.stringify(preferences),
    );
  }, [preferences, userId]);

  useEffect(() => {
    if (!loading && preferences.startView) {
      setCurrentView(preferences.startView);
    }
  }, [preferences.startView, loading]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    root.classList.toggle("panel-dark", preferences.theme === "dark");
    return () => {
      root.classList.remove("panel-dark");
    };
  }, [preferences.theme]);

  const sidebarAvatarUrl =
    (profileAvatarUrl && profileAvatarUrl.trim()) ||
    (isPublicAvatarUrl(preferences.avatarDataUrl)
      ? preferences.avatarDataUrl!.trim()
      : null) ||
    preferences.avatarDataUrl ||
    null;

  const presenceBroadcastAvatarUrl =
    (profileAvatarUrl && profileAvatarUrl.trim()) ||
    (isPublicAvatarUrl(preferences.avatarDataUrl)
      ? preferences.avatarDataUrl!.trim()
      : null);

  /** Presencia en vistas que no son captura (p. ej. panel principal): visible entre equipos vía Realtime. */
  useEffect(() => {
    if (loading || !userEmail) return;
    if (FULL_HEIGHT_INVENTORY_VIEWS.has(currentView)) return;

    const tabId = getSharedWorkPresenceTabId();
    const label = presenceVisibleLabel(userDisplayName, userEmail);
    const pulse = () => {
      publishWorkPresence({
        tabId,
        userKey: userEmail,
        userLabel: label,
        avatarUrl: presenceBroadcastAvatarUrl || null,
        ra: "",
        module: "none",
      });
    };
    pulse();
    const interval = window.setInterval(pulse, 12000);
    return () => {
      window.clearInterval(interval);
      void clearWorkPresence(tabId);
    };
  }, [
    loading,
    userEmail,
    userDisplayName,
    currentView,
    presenceBroadcastAvatarUrl,
  ]);

  const handleImport = async (newTasks: Task[]) => {
    const today = new Date().toISOString().split("T")[0]!;
    let normalized: Task[] = [];
    setTasks((prev) => {
      const existingRAs = new Set(
        prev.map((t) => String(t.ra || "").trim().toUpperCase()),
      );

      const dedupedNew = newTasks.filter((t) => {
        const raKey = String(t.ra || "").trim().toUpperCase();
        if (!raKey) return false;
        return !existingRAs.has(raKey);
      });

      if (dedupedNew.length === 0) return prev;

      normalized = dedupedNew.map((t) => {
        const base: Task = {
          ...t,
          date: t.date || today,
          dispatched: t.dispatched ?? false,
          containerDraft: t.containerDraft ?? false,
        };
        return withTaskContribution(base, userEmail, userDisplayName, "create");
      });
      return [...prev, ...normalized];
    });

    if (normalized.length === 0) return;
    try {
      await insertTasks(normalized);
    } catch (e) {
      console.error(e);
      // eslint-disable-next-line no-alert
      alert(
        "No se pudieron guardar las órdenes importadas en Supabase. Revisa tu conexión y la tabla `tasks`.",
      );
    }
  };

  const handleUpdateTask = async (updatedTask: Task) => {
    const persisted = withTaskContribution(
      updatedTask,
      userEmail,
      userDisplayName,
      "touch",
    );
    setTasks((prev) =>
      prev.map((t) => (t.id === persisted.id ? persisted : t)),
    );
    try {
      await updateTask(persisted);
    } catch (e) {
      console.error(e);
      // eslint-disable-next-line no-alert
      alert("No se pudo guardar el cambio en Supabase.");
      void reloadTasks();
    }
  };

  const handleDeleteTask = (idToRemove: string) => {
    setDeleteRaId(idToRemove);
  };

  const closeDeleteRaModal = () => {
    if (deleteRaBusy) return;
    setDeleteRaId(null);
  };

  const confirmDeleteTask = async () => {
    if (!deleteRaId) return;
    setDeleteRaBusy(true);
    try {
      await deleteTaskById(deleteRaId);
      setTasks((prev) => prev.filter((t) => t.id !== deleteRaId));
      setDeleteRaId(null);
    } catch (e) {
      console.error(e);
      // eslint-disable-next-line no-alert
      alert("No se pudo eliminar en Supabase.");
    } finally {
      setDeleteRaBusy(false);
    }
  };

  const taskPendingDelete =
    deleteRaId != null ? tasks.find((t) => t.id === deleteRaId) : undefined;

  const handleTransferTask = async (
    task: Task,
    newType: "quick" | "detailed" | "airway",
  ) => {
    const fromType = (task.type as string) || "quick";
    const adaptedMeasureData = adaptMeasureDataForModule(
      (task.measureData || []) as Record<string, unknown>[],
      fromType,
      newType,
    );
    const updated: Task = {
      ...task,
      type: newType,
      measureData: adaptedMeasureData as unknown[],
    };
    await handleUpdateTask(updated);
  };

  const openManualModal = (
    defaultModule: "quick" | "detailed" | "airway" = "quick",
  ) => {
    setModalState({
      isOpen: true,
      editingTask: null,
      defaultModule,
    });
  };

  const openEditModal = (task: Task) => {
    setModalState({
      isOpen: true,
      editingTask: task,
      defaultModule: (task.type as "quick" | "detailed" | "airway") || "quick",
    });
  };

  const closeManualModal = () => {
    setModalState({
      isOpen: false,
      editingTask: null,
      defaultModule: "quick",
    });
  };

  const handleSaveManualTask = async (taskData: Task) => {
    const today = new Date().toISOString().split("T")[0]!;
    const exists = tasks.some((t) => t.id === taskData.id);
    const duplicatedRA = tasks.some(
      (t) =>
        t.id !== taskData.id &&
        String(t.ra || "").trim().toUpperCase() ===
          String(taskData.ra || "").trim().toUpperCase(),
    );
    if (duplicatedRA) {
      // eslint-disable-next-line no-alert
      alert(
        `⚠️ El RA ${taskData.ra} ya existe en el sistema (ingresado, en proceso o en contenedor).`,
      );
      return;
    }
    const base: Task = {
      ...taskData,
      date: taskData.date || today,
      dispatched: taskData.dispatched ?? false,
      containerDraft: taskData.containerDraft ?? false,
    };
    const normalized = withTaskContribution(
      base,
      userEmail,
      userDisplayName,
      exists ? "touch" : "create",
    );
    try {
      if (exists) {
        await updateTask(normalized);
      } else {
        await insertTask(normalized);
      }
      setTasks((prev) => {
        if (exists) {
          return prev.map((t) => (t.id === taskData.id ? normalized : t));
        }
        return [...prev, normalized];
      });
      closeManualModal();
    } catch (e) {
      console.error(e);
      // eslint-disable-next-line no-alert
      alert("No se pudo guardar el RA en Supabase.");
    }
  };

  const handleEditContainer = async (container: {
    info: {
      type: string;
      consignment: string;
      number: string;
      bl: string;
      seal1: string;
      seal2: string;
      responsible: string;
      date: string;
    };
    tasks: Task[];
  }) => {
    const taskIds = container.tasks.map((t) => t.id);
    const updated: Task[] = tasks
      .filter((t) => taskIds.includes(t.id))
      .map((t) =>
        withTaskContribution(
          {
            ...t,
            dispatched: false,
            containerDraft: true,
            dispatchInfo: undefined,
          },
          userEmail,
          userDisplayName,
          "touch",
        ),
      );
    try {
      if (updated.length > 0) {
        await Promise.all(updated.map((t) => updateTask(t)));
      }
      setTasks((prev) =>
        prev.map((t) =>
          taskIds.includes(t.id)
            ? {
                ...t,
                dispatched: false,
                containerDraft: true,
                dispatchInfo: undefined,
              }
            : t,
        ),
      );
      setContainerToEdit({
        loadedIds: taskIds,
        containerInfo: container.info,
      });
      setCurrentView("dispatch");
    } catch (e) {
      console.error(e);
      // eslint-disable-next-line no-alert
      alert("No se pudo actualizar el contenedor en Supabase.");
    }
  };

  if (loading || !userEmail) {
    return null;
  }

  const visibleView =
    !showOptionsModule && currentView === "options" ? "dashboard" : currentView;

  return (
    <ControlPanelLayout
      currentView={visibleView}
      setCurrentView={setCurrentView}
      userDisplayName={userDisplayName}
      userAvatarSrc={sidebarAvatarUrl}
      preferences={preferences}
      showOptionsModule={showOptionsModule}
    >
      {tasksLoading && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-white/70 backdrop-blur-sm">
          <p className="text-sm font-black text-[#16263F] uppercase tracking-widest">
            Cargando órdenes…
          </p>
        </div>
      )}

      <div
        className={
          FULL_HEIGHT_INVENTORY_VIEWS.has(visibleView)
            ? "flex h-full min-h-0 w-full flex-1 flex-col overflow-x-hidden overflow-y-hidden"
            : "flex min-h-0 flex-1 flex-col w-full overflow-x-hidden overflow-y-auto"
        }
      >
        {visibleView === "dashboard" && (
          <ControlPanelHome
            tasks={tasks}
            onImport={handleImport}
            openManualModal={() => openManualModal("quick")}
            userDisplayName={userDisplayName}
            profileFullName={profileFullName}
            userEmail={userEmail}
            userAvatarSrc={sidebarAvatarUrl}
            preferences={preferences}
          />
        )}

        {visibleView === "quick-entry" && (
          <QuickInventoryEntry
            tasks={tasks}
            onUpdateTask={handleUpdateTask}
            onDeleteTask={handleDeleteTask}
            onTransferTask={handleTransferTask}
            openManualModal={() => openManualModal("quick")}
            openEditModal={openEditModal}
            presenceUserKey={userEmail}
            presenceUserLabel={userDisplayName}
            presenceAvatarUrl={presenceBroadcastAvatarUrl}
          />
        )}

        {visibleView === "detailed-entry" && (
          <DetailedInventoryEntry
            tasks={tasks}
            onUpdateTask={handleUpdateTask}
            onDeleteTask={handleDeleteTask}
            onTransferTask={handleTransferTask}
            openManualModal={() => openManualModal("detailed")}
            openEditModal={openEditModal}
            presenceUserKey={userEmail}
            presenceUserLabel={userDisplayName}
            presenceAvatarUrl={presenceBroadcastAvatarUrl}
          />
        )}

        {visibleView === "airway" && (
          <QuickInventoryEntry
            moduleType="airway"
            tasks={tasks}
            onUpdateTask={handleUpdateTask}
            onDeleteTask={handleDeleteTask}
            onTransferTask={handleTransferTask}
            openManualModal={() => openManualModal("airway")}
            openEditModal={openEditModal}
            presenceUserKey={userEmail}
            presenceUserLabel={userDisplayName}
            presenceAvatarUrl={presenceBroadcastAvatarUrl}
          />
        )}

        {visibleView === "collection-orders" && (
          <CollectionOrderModule
            tasks={tasks}
            onUpdateTask={handleUpdateTask}
            userEmail={userEmail}
            userDisplayName={userDisplayName}
          />
        )}

        {visibleView === "reference-catalog" && <ReferenceCatalogModule />}

        {visibleView === "reports" && (
          <CompletedReportsModule
            tasks={tasks}
            onDeleteTask={handleDeleteTask}
            onUpdateTask={handleUpdateTask}
            onAddTasks={handleImport}
          />
        )}

        {visibleView === "productivity" && (
          <ProductivityInsightsPanel
            tasks={tasks}
            userEmail={userEmail}
            userDisplayName={userDisplayName}
          />
        )}

        {visibleView === "dispatch" && (
          <DispatchEntry
            tasks={tasks}
            onUpdateTask={handleUpdateTask}
            containerToEdit={containerToEdit}
            clearEdit={() => setContainerToEdit(null)}
            operatorDisplayName={userDisplayName}
          />
        )}

        {visibleView === "container-reports" && (
          <ContainerReportsModule tasks={tasks} onEditContainer={handleEditContainer} />
        )}

        {visibleView === "monitor" && (
          <LiveMonitor
            tasks={tasks}
            onDeleteTask={handleDeleteTask}
            userEmail={userEmail}
            userDisplayName={userDisplayName}
            userAvatarSrc={presenceBroadcastAvatarUrl}
          />
        )}

        {showOptionsModule && visibleView === "options" && (
          <UserOptionsPanel
            userId={userId}
            userDisplayName={userDisplayName}
            avatarPreviewSrc={sidebarAvatarUrl}
            preferences={preferences}
            onChangePreferences={setPreferences}
            onServerAvatarChange={setProfileAvatarUrl}
          />
        )}
      </div>

      {modalState.isOpen && (
        <ManualEntryModal
          onClose={closeManualModal}
          onSave={handleSaveManualTask}
          initialData={modalState.editingTask}
          defaultModule={modalState.defaultModule}
        />
      )}

      <DeleteRaConfirmModal
        open={deleteRaId != null}
        raLabel={String(taskPendingDelete?.ra ?? "").trim() || "—"}
        clientHint={
          taskPendingDelete
            ? [taskPendingDelete.mainClient, taskPendingDelete.provider]
                .map((s) => String(s ?? "").trim())
                .filter(Boolean)
                .join(" · ") || undefined
            : undefined
        }
        busy={deleteRaBusy}
        onCancel={closeDeleteRaModal}
        onConfirm={() => void confirmDeleteTask()}
      />
    </ControlPanelLayout>
  );
}
