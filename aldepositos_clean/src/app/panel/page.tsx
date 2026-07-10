"use client";

import React, { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
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
import { ManualEntryModal } from "@/components/modals/ManualEntryModal";
import { DeleteRaConfirmModal } from "@/components/modals/DeleteRaConfirmModal";
import { adaptMeasureDataForModule } from "@/lib/taskUtils";
import {
  DEFAULT_USER_PREFERENCES,
  LAST_THEME_STORAGE_KEY,
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
import { fetchWithTimeout } from "@/lib/clientFetch";

function PanelModuleLoader() {
  return (
    <div className="flex min-h-[12rem] flex-1 items-center justify-center p-8">
      <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">Cargando módulo…</p>
    </div>
  );
}

const QuickInventoryEntry = dynamic(
  () =>
    import("@/components/control-panel/QuickInventoryEntry").then(
      (m) => m.QuickInventoryEntry,
    ),
  { loading: () => <PanelModuleLoader /> },
);
const DetailedInventoryEntry = dynamic(
  () =>
    import("@/components/control-panel/DetailedInventoryEntry").then(
      (m) => m.DetailedInventoryEntry,
    ),
  { loading: () => <PanelModuleLoader /> },
);
const CompletedReportsModule = dynamic(
  () =>
    import("@/components/control-panel/CompletedReportsModule").then(
      (m) => m.CompletedReportsModule,
    ),
  { loading: () => <PanelModuleLoader /> },
);
const DispatchEntry = dynamic(
  () => import("@/components/control-panel/DispatchEntry").then((m) => m.DispatchEntry),
  { loading: () => <PanelModuleLoader /> },
);
const ContainerReportsModule = dynamic(
  () =>
    import("@/components/control-panel/ContainerReportsModule").then(
      (m) => m.ContainerReportsModule,
    ),
  { loading: () => <PanelModuleLoader /> },
);
const ReferenceCatalogModule = dynamic(
  () =>
    import("@/components/control-panel/ReferenceCatalogModule").then(
      (m) => m.ReferenceCatalogModule,
    ),
  { loading: () => <PanelModuleLoader /> },
);
const CollectionOrderModule = dynamic(
  () =>
    import("@/components/control-panel/CollectionOrderModule").then(
      (m) => m.CollectionOrderModule,
    ),
  { loading: () => <PanelModuleLoader /> },
);
const TruckDirectionModule = dynamic(
  () =>
    import("@/components/truck-direction/TruckDirectionModule").then(
      (m) => m.TruckDirectionModule,
    ),
  { loading: () => <PanelModuleLoader /> },
);
const ReceptionistModule = dynamic(
  () =>
    import("@/components/control-panel/ReceptionistModule").then(
      (m) => m.ReceptionistModule,
    ),
  { loading: () => <PanelModuleLoader /> },
);
const UserOptionsPanel = dynamic(
  () =>
    import("@/components/control-panel/UserOptionsPanel").then(
      (m) => m.UserOptionsPanel,
    ),
  { loading: () => <PanelModuleLoader /> },
);
const InventoryLeaderboardModule = dynamic(
  () =>
    import("@/components/control-panel/InventoryLeaderboardModule").then(
      (m) => m.InventoryLeaderboardModule,
    ),
  { loading: () => <PanelModuleLoader /> },
);

/** Vistas donde la tabla debe usar toda la altura del main (scroll solo dentro del módulo). */
const FULL_HEIGHT_INVENTORY_VIEWS = new Set([
  "quick-entry",
  "detailed-entry",
  "collection-orders",
  "receptionist",
  "truck-direction",
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
    userKey: userEmail,
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
    defaultModule: "quick" | "detailed";
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
            const res = await fetchWithTimeout(
              `${window.location.origin}/api/me/display-name`,
              {
                headers: { Authorization: `Bearer ${accessToken}` },
                timeoutMs: 20_000,
              },
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
          try {
            window.localStorage.setItem(LAST_THEME_STORAGE_KEY, nextPrefs.theme);
            document.documentElement.classList.toggle("panel-dark", nextPrefs.theme === "dark");
          } catch {
            /* almacenamiento no disponible */
          }
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
    const isDark = preferences.theme === "dark";
    root.classList.toggle("panel-dark", isDark);
    try {
      window.localStorage.setItem(LAST_THEME_STORAGE_KEY, preferences.theme);
    } catch {
      /* almacenamiento no disponible */
    }
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) {
      themeMeta.setAttribute("content", isDark ? "#0b1220" : "#16263F");
    }
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
    let intervalId: number | undefined;
    const start = () => {
      pulse();
      if (intervalId != null) window.clearInterval(intervalId);
      intervalId = window.setInterval(pulse, 20_000);
    };
    const stop = () => {
      if (intervalId != null) {
        window.clearInterval(intervalId);
        intervalId = undefined;
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") start();
      else stop();
    };
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
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
        return base;
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
    // Actualización optimista: no se revierte ante un fallo puntual de red.
    setTasks((prev) =>
      prev.map((t) => (t.id === updatedTask.id ? updatedTask : t)),
    );
    try {
      await updateTask(updatedTask);
    } catch (e) {
      // No recargamos (evita pisar lo capturado con datos viejos del servidor).
      // Propagamos el error para que el autoguardado programe un reintento.
      console.error(e);
      throw e;
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
    newType: "quick" | "detailed",
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
    try {
      await handleUpdateTask(updated);
    } catch (e) {
      console.error(e);
      // eslint-disable-next-line no-alert
      alert("No se pudo transferir la orden en Supabase.");
    }
  };

  const openManualModal = useCallback(
    (defaultModule: "quick" | "detailed" = "quick") => {
      setModalState({
        isOpen: true,
        editingTask: null,
        defaultModule,
      });
    },
    [],
  );

  const openQuickManualModal = useCallback(
    () => openManualModal("quick"),
    [openManualModal],
  );
  const openDetailedManualModal = useCallback(
    () => openManualModal("detailed"),
    [openManualModal],
  );
  const openEditModal = useCallback((task: Task) => {
    setModalState({
      isOpen: true,
      editingTask: task,
      defaultModule:
        task.type === "detailed" ? "detailed" : "quick",
    });
  }, []);

  const closeManualModal = useCallback(() => {
    setModalState({
      isOpen: false,
      editingTask: null,
      defaultModule: "quick",
    });
  }, []);

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
    try {
      if (exists) {
        await updateTask(base);
      } else {
        await insertTask(base);
      }
      setTasks((prev) => {
        if (exists) {
          return prev.map((t) => (t.id === taskData.id ? base : t));
        }
        return [...prev, base];
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
      .map((t) => ({
        ...t,
        dispatched: false,
        containerDraft: true,
        dispatchInfo: undefined,
      }));
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
      userEmail={userEmail}
      userAvatarSrc={sidebarAvatarUrl}
      preferences={preferences}
      showOptionsModule={showOptionsModule}
    >
      {tasksLoading && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-white/70 backdrop-blur-sm panel-loading-overlay safe-area-insets">
          <p className="text-fluid-subtitle px-4 text-center font-black uppercase tracking-widest text-[#16263F]">
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
            openManualModal={openQuickManualModal}
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
            openManualModal={openQuickManualModal}
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
            openManualModal={openDetailedManualModal}
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

        {visibleView === "receptionist" && (
          <ReceptionistModule userEmail={userEmail} />
        )}

        {visibleView === "truck-direction" && <TruckDirectionModule />}

        {visibleView === "reference-catalog" && <ReferenceCatalogModule />}

        {visibleView === "reports" && (
          <CompletedReportsModule tasks={tasks} onDeleteTask={handleDeleteTask} />
        )}

        {visibleView === "inventory-leaderboard" && (
          <InventoryLeaderboardModule
            tasks={tasks}
            userDisplayName={userDisplayName}
            userEmail={userEmail}
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
