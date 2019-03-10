import * as React from "react";
import { MemoryRouter as Router } from "react-router-dom";
import ConnectionListContainer from "../containers/ConnectionListContainer";
import Button from "../ui/Button";
import Modal from "../ui/Modal";
import Tab from "../ui/Tab";

interface IState {
    isVisible: boolean;
    activeTab: string;
}

class App extends React.Component<{}, IState> {
    public state = {
        activeTab: "lorem",
        isVisible: false,
    };

    public handleButtonClick = () => {
        this.setState({ isVisible: true });
    }

    public handleClose = () => {
        this.setState({ isVisible: false });
    }
    public handleTabChange = (key: string) => {
        this.setState({ activeTab: key });
    }
    public render() {
        return (
            <div>
                <ConnectionListContainer />
            </div>
        );
    }
}

export default App;
