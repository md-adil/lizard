import { ADD, CREATE, ConnectionActionTypes, IConnectionState, UPDATE } from "../actions/connection";

const initialState: IConnectionState = {
    data: [],
    isCreating: false,
};

export default (
        state = initialState, action: ConnectionActionTypes,
    ): IConnectionState => {
    switch (action.type) {
        case CREATE:
            return { ...state, isCreating: action.payload as boolean };
        case ADD:
            return { ...state, data: state.data };
        case UPDATE:
        default:
            return state;
    }
};
