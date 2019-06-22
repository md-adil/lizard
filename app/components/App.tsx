import * as React from "react";
import ConnectionListContainer from "../containers/ConnectionListContainer";
import ContentContainer from "../containers/ContentContainer";
import "./app.scss";
import Button from "../ui/Button";
import CreateConnectionContainer from "../containers/CreateConnectionContainer";

interface IProps {
    onAddConnection: () => void;
}

export default ({onAddConnection}: IProps) => (
    <div id="root">
        <header>
            <CreateConnectionContainer />
            <Button onClick={onAddConnection}>Add one</Button>
        </header>
        <main>
            <aside>
                <ConnectionListContainer />
            </aside>
            <ContentContainer />
        </main>
    </div>
)
