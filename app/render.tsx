import * as React from "react";
import { Provider } from "react-redux";
import * as ReactDOM from "react-dom";
import AppContainer from "./containers/AppContainer";
import store from "./store";
const app = document.createElement("div");

document.body.appendChild(app);

const RootContainer = () => (
    <Provider store={store}>
        <AppContainer />
    </Provider>
);

ReactDOM.render(<RootContainer />, app);
