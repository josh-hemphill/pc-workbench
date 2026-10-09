import type { StorageBindings } from './types';

/** Preserve optional wiring through allocations/snapshots; never infer physical endpoints. */
export function mapStorageBindings(record: StorageBindings, resolve: (id: string) => string = id => id): StorageBindings {
  return {
    ...(record.bayTargetIds !== undefined ? { bayTargetIds: [...record.bayTargetIds] } : {}),
    ...(record.sataDataConnections !== undefined ? { sataDataConnections: record.sataDataConnections.map(connection => ({ ...connection, controllerPlacementId: resolve(connection.controllerPlacementId) })) } : {}),
    ...(record.sataPowerConnections !== undefined ? { sataPowerConnections: record.sataPowerConnections.map(connection => ({ ...connection, powerProviderPlacementId: resolve(connection.powerProviderPlacementId) })) } : {}),
  };
}

export function storageBindingsMatch(planned: StorageBindings, actual: StorageBindings, resolve: (id: string) => string): boolean {
  if (planned.bayTargetIds?.length && JSON.stringify([...planned.bayTargetIds].sort()) !== JSON.stringify([...(actual.bayTargetIds || [])].sort())) return false;
  for (const connection of planned.sataDataConnections || []) {
    if (!actual.sataDataConnections?.some(value => (value.inputId || '') === (connection.inputId || '') && (!connection.portId || value.portId === connection.portId) && (!connection.controllerPlacementId || resolve(value.controllerPlacementId) === resolve(connection.controllerPlacementId)))) return false;
  }
  for (const connection of planned.sataPowerConnections || []) {
    if (!actual.sataPowerConnections?.some(value => (value.inputId || '') === (connection.inputId || '') && (!connection.connectorId || value.connectorId === connection.connectorId) && (!connection.powerProviderPlacementId || resolve(value.powerProviderPlacementId) === resolve(connection.powerProviderPlacementId)))) return false;
  }
  return true;
}
