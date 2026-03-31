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
import { UserOptionsPanel } from "@/components/control-panel/UserOptionsPanel";
import { ManualEntryModal } from "@/components/modals/ManualEntryModal";
import { adaptMeasureDataForModule } from "@/lib/taskUtils";
import {
  DEFAULT_USER_PREFERENCES,
  sanitizeUserPreferences,
  userPrefsStorageKey,
  type UserPreferences,
} from "@/lib/userPreferences";

/** Vistas donde la tabla debe usar toda la altura del main (scroll solo dentro del módulo). */
const FULL_HEIGHT_INVENTORY_VIEWS = new Set([
  "quick-entry",
  "detailed-entry",
  "airway",
]);

export default function PanelPage() {
  const router = useRouter();
  const showOptionsModule = process.env.NODE_ENV === "development";
  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userDisplayName, setUserDisplayName] = useState<string | null>(null);
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

        const { data: profile } = await supabase
          .from("profiles")
          .select("full_name, username, email")
          .eq("id", user.id)
          .single();

        const displayName =
          profile?.full_name || profile?.username || profile?.email || email;
        setUserDisplayName(displayName ?? "Operador Aldepósitos");

        if (typeof window !== "undefined") {
          const raw = window.localStorage.getItem(userPrefsStorageKey(user.id));
          if (raw) {
            try {
              setPreferences(sanitizeUserPreferences(JSON.parse(raw)));
            } catch {
              setPreferences(DEFAULT_USER_PREFERENCES);
            }
          } else {
            setPreferences(DEFAULT_USER_PREFERENCES);
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
    root.classList.toggle("panel-dark", preferences.theme === "dark");
  }, [preferences.theme]);

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

      normalized = dedupedNew.map((t) => ({
        ...t,
        date: t.date || today,
        dispatched: t.dispatched ?? false,
        containerDraft: t.containerDraft ?? false,
      }));
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
    setTasks((prev) =>
      prev.map((t) => (t.id === updatedTask.id ? updatedTask : t)),
    );
    try {
      await updateTask(updatedTask);
    } catch (e) {
      console.error(e);
      // eslint-disable-next-line no-alert
      alert("No se pudo guardar el cambio en Supabase.");
      void reloadTasks();
    }
  };

  const handleDeleteTask = async (idToRemove: string) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm("¿Estás seguro de que deseas eliminar este RA?")) {
      return;
    }
    try {
      await deleteTaskById(idToRemove);
      setTasks((prev) => prev.filter((t) => t.id !== idToRemove));
    } catch (e) {
      console.error(e);
      // eslint-disable-next-line no-alert
      alert("No se pudo eliminar en Supabase.");
    }
  };

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
    const normalized: Task = {
      ...taskData,
      date: taskData.date || today,
      dispatched: taskData.dispatched ?? false,
      containerDraft: taskData.containerDraft ?? false,
    };
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
            userEmail={userEmail}
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
          />
        )}

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
            userDisplayName={userDisplayName}
          />
        )}

        {visibleView === "dispatch" && (
          <DispatchEntry
            tasks={tasks}
            onUpdateTask={handleUpdateTask}
            containerToEdit={containerToEdit}
            clearEdit={() => setContainerToEdit(null)}
            userEmail={userEmail}
          />
        )}

        {visibleView === "container-reports" && (
          <ContainerReportsModule tasks={tasks} onEditContainer={handleEditContainer} />
        )}

        {visibleView === "monitor" && (
          <LiveMonitor tasks={tasks} onDeleteTask={handleDeleteTask} />
        )}

        {showOptionsModule && visibleView === "options" && (
          <UserOptionsPanel
            userDisplayName={userDisplayName}
            userEmail={userEmail}
            preferences={preferences}
            onChangePreferences={setPreferences}
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
    </ControlPanelLayout>
  );
}
