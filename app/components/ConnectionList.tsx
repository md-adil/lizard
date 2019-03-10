import * as React from "react";
import { IConnection } from "../actions/connection";
import CreateConnectionContainer from "../containers/CreateConnectionContainer";
import Button from "../ui/Button";

interface IProps {
    connections: IConnection[];
}

export default (props: IProps) => (
    <div>
        <Button>Add one</Button>
        <CreateConnectionContainer />
    </div>
);
