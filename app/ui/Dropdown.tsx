import * as React from "react";
const { useState, useEffect } = React;
import { createPortal } from "react-dom";
import classnames from "classnames";

import "./dropdown.scss";
export interface IProps {
    children: React.ReactElement;
    overlay: React.ReactElement;
    className?: any;
}

const Overlay = ({ children }: { children: React.ReactElement }) => {
    return <div className="ui dropdown-items">{children}</div>;
};

export default (props: IProps) => {
    const [visible, setVisible] = useState(false);
    const [position, setPositiion] = useState({});
    return (
        <span
            className={classnames("ui dropdown", props.className, { visible })}
        >
            <Overlay>{props.overlay}</Overlay>
            {React.cloneElement(props.children, {
                onClick: (e: React.MouseEvent<HTMLAnchorElement>) => {
                    setVisible(!visible);
                    setPositiion({ x: e.clientX, y: e.clientY });
                }
            })}
        </span>
    );
};
