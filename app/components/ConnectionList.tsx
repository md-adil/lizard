import * as React from "react";
import Button from "../ui/Button";

interface IProps {
    connections: any[];
}
export default (props: IProps) => (
    <div>
        <Button>Add one</Button>
    </div>
);
