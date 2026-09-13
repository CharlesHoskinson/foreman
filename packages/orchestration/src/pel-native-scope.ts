/** Filesystem and request identities needed by native enforcement.
 * A qualification scope grants only its disposable workspace. It is not a
 * product execution binding and carries no publication or action authority.
 */
export interface PelNativeScopeV1 {
    readonly workspace: {
        readonly grantId: string;
        readonly canonicalRoot: string;
        readonly directoryIdentity: string;
        readonly writablePaths: readonly string[];
    };
    readonly binding: {
        readonly stateRoot: string;
        readonly repository: {
            readonly gitCommonDir: string;
        };
    };
}
export interface PelNativePermissionScopeV1 extends PelNativeScopeV1 {
    readonly effect: {
        readonly effectId: string;
    };
}
