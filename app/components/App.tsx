import * as React from "react";
import ConnectionListContainer from "../containers/ConnectionListContainer";

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
