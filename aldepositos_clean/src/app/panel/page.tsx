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
import { Hammer, Plane } from "lucide-react";
import { ControlPanelLayout } from "@/components/layout/ControlPanelLayout";
import { ControlPanelHome } from "@/components/control-panel/ControlPanelHome";
import { QuickInventoryEntry } from "@/components/control-panel/QuickInventoryEntry";
import { DetailedInventoryEntry } from "@/components/control-panel/DetailedInventoryEntry";
import { CompletedReportsModule } from "@/components/control-panel/CompletedReportsModule";
import { LiveMonitor } from "@/components/control-panel/LiveMonitor";
import { ModulePlaceholder } from "@/components/control-panel/ModulePlaceholder";
import { DispatchEntry } from "@/components/control-panel/DispatchEntry";
import { ContainerReportsModule } from "@/components/control-panel/ContainerReportsModule";
import { ManualEntryModal } from "@/components/modals/ManualEntryModal";
import { adaptMeasureDataForModule } from "@/lib/taskUtils";

export default function PanelPage() {
  const router = useRouter();
  const [userEmail, setUserEmail] = useState<string | null>(null);
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
      if (!data.user?.email) {
        router.replace("/login");
      } else {
        setUserEmail(data.user.email);
      }
      setLoading(false);
    };
    checkSession();
  }, [router]);

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

  return (
    <ControlPanelLayout
      currentView={currentView}
      setCurrentView={setCurrentView}
    >
      {tasksLoading && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-white/70 backdrop-blur-sm">
          <p className="text-sm font-black text-[#16263F] uppercase tracking-widest">
            Cargando órdenes…
          </p>
        </div>
      )}

      {currentView === "dashboard" && (
        <ControlPanelHome
          tasks={tasks}
          onImport={handleImport}
          openManualModal={() => openManualModal("quick")}
          userEmail={userEmail}
        />
      )}

      {currentView === "quick-entry" && (
        <QuickInventoryEntry
          tasks={tasks}
          onUpdateTask={handleUpdateTask}
          onDeleteTask={handleDeleteTask}
          onTransferTask={handleTransferTask}
          openManualModal={() => openManualModal("quick")}
          openEditModal={openEditModal}
        />
      )}

      {currentView === "detailed-entry" && (
        <DetailedInventoryEntry
          tasks={tasks}
          onUpdateTask={handleUpdateTask}
          onDeleteTask={handleDeleteTask}
          onTransferTask={handleTransferTask}
          openManualModal={() => openManualModal("detailed")}
          openEditModal={openEditModal}
        />
      )}

      {currentView === "airway" && (
        <ModulePlaceholder
          moduleTitle={
            <>
              <Plane className="text-orange-500 w-5 h-5 md:w-8 md:h-8" /> GUÍA
              AÉREA
            </>
          }
          icon={<Hammer className="w-16 h-16 text-orange-200" />}
          subtitle="Módulo en Actualización"
          description="Esta sección está siendo ajustada. Estará operativa pronto."
        />
      )}

      {currentView === "reports" && (
        <CompletedReportsModule
          tasks={tasks}
          onDeleteTask={handleDeleteTask}
          onUpdateTask={handleUpdateTask}
          onAddTasks={handleImport}
        />
      )}

      {currentView === "dispatch" && (
        <DispatchEntry
          tasks={tasks}
          onUpdateTask={handleUpdateTask}
          containerToEdit={containerToEdit}
          clearEdit={() => setContainerToEdit(null)}
          userEmail={userEmail}
        />
      )}

      {currentView === "container-reports" && (
        <ContainerReportsModule tasks={tasks} onEditContainer={handleEditContainer} />
      )}

      {currentView === "monitor" && (
        <LiveMonitor tasks={tasks} onDeleteTask={handleDeleteTask} />
      )}

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
