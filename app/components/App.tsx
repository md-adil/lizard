import * as React from "react";
import { MemoryRouter as Router } from "react-router-dom";
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
                <Button onClick={this.handleButtonClick}>Click</Button>
                <Modal visible={this.state.isVisible} title="Hello World" onClose={this.handleClose}>
                    Lorem ipsum dolor sit amet consectetur adipisicing elit. Cumque id perspiciatis repellendus vitae,
                    iusto maxime odit non adipisci minus
                    consequatur illo quas earum laborum optio.
                    Magnam architecto vero sequi. Et?
                </Modal>
                <Tab active={this.state.activeTab} onChange={this.handleTabChange}>
                    <Tab.Pane key="lorem" title="Lorem">Hello World</Tab.Pane>
                    <Tab.Pane key="ipsum" title="Ipsum">This is ipsum page</Tab.Pane>
                </Tab>
            </div>
        );
    }
}

export default App;
