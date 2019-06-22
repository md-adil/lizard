import * as React from "react";
import { range } from "lodash";
import "./spinner.scss";
interface IProps {
    size?: number | string;
}

export default ({size, ...props}: IProps) => (
    <div className="spinner lds-ring" style={{height: size, width: size}} {...props}>
        { range(4).map( (n) => <div key={n} />)}
    </div>
);
