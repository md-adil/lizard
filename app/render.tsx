import React from "react";
import { Provider } from "react-redux";
import ReactDOM from "react-dom";
import AppContainer from "./containers/AppContainer";
import store from "./store";
const app = document.createElement("div");
app.id = "app";
document.body.appendChild(app);

const RootContainer = () => (
    <Provider store={store}>
        <AppContainer />
    </Provider>
);
console.log("REndering app");
ReactDOM.render(<RootContainer />, app);
