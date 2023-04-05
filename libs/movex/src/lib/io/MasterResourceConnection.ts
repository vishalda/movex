import {
  ActionOrActionTupleFromAction,
  AnyAction,
  CheckedReconciliatoryActions,
  ToCheckedAction,
} from '../tools/action';
import {
  invoke,
  IOPayloadResultErrType,
  IOPayloadResultOkType,
  ResourceIdentifier,
  ResourceIdentifierStr,
  toResourceIdentifierObj,
  toResourceIdentifierStr,
} from 'movex-core-util';
import { Pubsy } from 'ts-pubsy';
import { UnsubscribeFn } from '../core-types';
import { MasterClientConnection } from './MasterClientConnection';
import { AsyncResult } from 'ts-async-results';
import { Err, Ok } from 'ts-results';
import { MasterClientIOEvents } from './MasterClientIOEvents';

/**
 * This handles the connection with Master per ResourceType
 */
export class MasterResourceConnection<
  TState extends any,
  TAction extends AnyAction,
  TResourceType extends string
> {
  private fwdActionPubsy = new Pubsy<{
    [key in `rid:${ResourceIdentifierStr<TResourceType>}`]: ToCheckedAction<TAction>;
  }>();

  private reconciliatoryActionPubsy = new Pubsy<{
    [key in `rid:${ResourceIdentifierStr<TResourceType>}`]: CheckedReconciliatoryActions<TAction>;
  }>();

  private unsubscribers: UnsubscribeFn[] = [];

  constructor(
    resourceType: TResourceType,
    private masterConnection: MasterClientConnection<
      TState,
      TAction,
      TResourceType
    >
  ) {
    const onFwdActionHandler = (
      p: {
        rid: ResourceIdentifier<TResourceType>;
      } & ToCheckedAction<TAction>
    ) => {
      if (toResourceIdentifierObj(p.rid).resourceType !== resourceType) {
        return;
      }

      this.fwdActionPubsy.publish(`rid:${toResourceIdentifierStr(p.rid)}`, p);
    };

    const onReconciliateActionsHandler = (
      p: {
        rid: ResourceIdentifier<TResourceType>;
      } & CheckedReconciliatoryActions<TAction>
    ) => {
      if (toResourceIdentifierObj(p.rid).resourceType !== resourceType) {
        return;
      }

      this.reconciliatoryActionPubsy.publish(
        `rid:${toResourceIdentifierStr(p.rid)}`,
        p
      );
    };

    masterConnection.emitter.on(
      'reconciliateActions',
      onReconciliateActionsHandler
    );

    masterConnection.emitter.on('fwdAction', onFwdActionHandler);

    // Unsubscribe from the events too
    this.unsubscribers = [
      () => masterConnection.emitter.off('fwdAction', onFwdActionHandler),
      () =>
        masterConnection.emitter.off(
          'reconciliateActions',
          onReconciliateActionsHandler
        ),
    ];
  }

  create(resourceType: TResourceType, resourceState: TState) {
    type CreateEvent = ReturnType<
      MasterClientIOEvents<TState, TAction, TResourceType>['createResource']
    >;

    return AsyncResult.toAsyncResult<
      IOPayloadResultOkType<CreateEvent>,
      IOPayloadResultErrType<CreateEvent>
    >(
      this.masterConnection.emitter
        .emitAndAcknowledge('createResource', {
          // clientId: this.masterConnection.clientId,
          resourceState,
          resourceType,
        })
        .then((res) => (res.ok ? new Ok(res.val) : new Err(res.val)))
    );
  }

  get(rid: ResourceIdentifier<TResourceType>) {
    type GetEvent = ReturnType<
      MasterClientIOEvents<TState, TAction, TResourceType>['getResourceState']
    >;

    return AsyncResult.toAsyncResult<
      IOPayloadResultOkType<GetEvent>,
      IOPayloadResultErrType<GetEvent>
    >(
      this.masterConnection.emitter
        .emitAndAcknowledge('getResourceState', { rid })
        .then((res) => (res.ok ? new Ok(res.val) : new Err(res.val)))
    );
  }

  emitAction(
    rid: ResourceIdentifier<TResourceType>,
    actionOrActionTuple: ActionOrActionTupleFromAction<TAction>
  ) {
    type EmitActionEvent = ReturnType<
      MasterClientIOEvents<TState, TAction, TResourceType>['emitAction']
    >;

    return AsyncResult.toAsyncResult<
      IOPayloadResultOkType<EmitActionEvent>,
      IOPayloadResultErrType<EmitActionEvent>
    >(
      this.masterConnection.emitter
        .emitAndAcknowledge('emitAction', {
          rid,
          action: actionOrActionTuple,
        })
        .then((res) => (res.ok ? new Ok(res.val) : new Err(res.val)))
    );
  }

  onFwdAction(
    rid: ResourceIdentifier<TResourceType>,
    fn: (p: ToCheckedAction<TAction>) => void
  ) {
    return this.fwdActionPubsy.subscribe(
      `rid:${toResourceIdentifierStr(rid)}`,
      fn
    );
  }

  onReconciliatoryActions(
    rid: ResourceIdentifier<TResourceType>,
    fn: (p: CheckedReconciliatoryActions<TAction>) => void
  ) {
    return this.reconciliatoryActionPubsy.subscribe(
      `rid:${toResourceIdentifierStr(rid)}`,
      fn
    );
  }

  destroy() {
    this.unsubscribers.forEach(invoke);
  }
}
