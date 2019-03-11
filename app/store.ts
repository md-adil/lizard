import { createStore } from "redux";
import rootReducers from "./reducers";

export type AppState = ReturnType<typeof rootReducers>;

export default createStore(rootReducers);
