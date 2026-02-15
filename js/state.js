const initialState = {
    selectedFloor: null,
    selectedDate: null,
    selectedStartTime: null,
    selectedEndTime: null,
    calendarYear: new Date().getFullYear(),
    calendarMonth: new Date().getMonth(),
    reservations: [],
    currentReservedSlots: [],
    currentTab: 'all',
    pendingAction: null,
    pendingId: null,
    reservationAuthToken: null,
    editReservationId: null,
    editOriginalReservation: null,
    deleteTargetReservation: null,
    adminAuthToken: null
};

const listeners = new Set();

export const state = new Proxy(initialState, {
    set(target, property, value) {
        target[property] = value;
        listeners.forEach(cb => cb(property, value));
        return true;
    }
});

export function subscribe(callback) {
    listeners.add(callback);
    return () => listeners.delete(callback);
}
