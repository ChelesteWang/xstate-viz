import React, { Component, createContext, useState, useReducer } from 'react';
import { StateChart, notificationsMachine } from './index';
import styled from 'styled-components';
import { Machine, assign, EventObject, State, Interpreter } from 'xstate';
import queryString from 'query-string';
import { useMachine } from '@xstate/react';
import { log, send } from 'xstate/lib/actions';
import { User } from './User';

import { examples } from './examples';
import { Header, notificationsActor } from './Header';
import { Logo } from './logo';
import { Loader } from './Loader';
import { LayoutButton, StyledLayoutButton } from './LayoutButton';
import { toMachine } from './StateChart';
import { getEdges } from 'xstate/lib/graph';

const StyledApp = styled.main`
  --color-app-background: #fff;
  --color-border: #dedede;
  --color-primary: rgba(87, 176, 234, 1);
  --color-primary-faded: rgba(87, 176, 234, 0.5);
  --color-primary-shadow: rgba(87, 176, 234, 0.1);
  --color-link: rgba(87, 176, 234, 1);
  --color-disabled: #c7c5c5;
  --color-edge: rgba(0, 0, 0, 0.2);
  --color-edge-active: var(--color-primary);
  --color-secondary: rgba(255, 152, 0, 1);
  --color-secondary-light: rgba(255, 152, 0, 0.5);
  --color-sidebar: #272722;
  --radius: 0.2rem;
  --border-width: 2px;
  --sidebar-width: 25rem;
  --shadow: 0 0.5rem 1rem var(--shadow-color, rgba(0, 0, 0, 0.2));
  --duration: 0.2s;
  --easing: cubic-bezier(0.5, 0, 0.5, 1);

  height: 100%;
  display: grid;
  grid-template-areas:
    'header sidebar'
    'content content';
  grid-template-rows: 3rem auto;
  grid-template-columns: auto var(--sidebar-width);
  overflow: hidden;

  > ${StyledLayoutButton} {
    display: inline-block;
    grid-row: 2;
    grid-column: -1;
  }
`;

export const StyledHeader = styled.header`
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: stretch;
  grid-area: header;
  padding: 0.5rem 1rem;
  z-index: 1;
`;

export const StyledLogo = styled(Logo)`
  height: 2rem;
`;

export const StyledLinks = styled.nav`
  display: flex;
  flex-direction: row;
  margin-left: auto;

  &,
  &:visited {
  }
`;

export const StyledLink = styled.a`
  text-decoration: none;
  color: #57b0ea;
  text-transform: uppercase;
  display: block;
  font-size: 75%;
  font-weight: bold;
  margin: 0 0.25rem;
`;

interface AppMachineContext {
  query: {
    gist?: string;
    code?: string;
    layout?: string;
  };
  token?: string;
  example: any;
  user: any;
  /**
   * Gist ID
   */
  gist?: string;
  /**
   * Saving deferred until authorization
   */
  pendingSave: boolean;
}

const invokeSaveGist = (ctx: AppMachineContext, e: EventObject) => {
  return fetch(`https://api.github.com/gists/` + ctx.gist!, {
    method: 'post',
    body: JSON.stringify({
      description: 'XState test',
      files: {
        'machine.js': { content: e.code }
      }
    }),
    headers: {
      Authorization: `token ${ctx.token}`
    }
  }).then(async response => {
    if (!response.ok) {
      throw new Error((await response.json()).message);
    }

    return response.json();
  });
};

const invokePostGist = (ctx: AppMachineContext, e: EventObject) => {
  return fetch(`https://api.github.com/gists`, {
    method: 'post',
    body: JSON.stringify({
      description: 'XState test',
      files: {
        'machine.js': { content: e.code }
      }
    }),
    headers: {
      Authorization: `token ${ctx.token}`
    }
  }).then(response => {
    if (!response.ok) {
      throw new Error('Unable to post gist');
    }

    return response.json();
  });
};

const invokeFetchGist = (ctx: AppMachineContext) => {
  return fetch(`https://api.github.com/gists/${ctx.query.gist}`, {
    headers: {
      Accept: 'application/json'
    }
  }).then(async data => {
    if (!data.ok) {
      throw new Error((await data.json()).message);
    }

    return data.json();
  });
};

const getUser = (ctx: AppMachineContext) => {
  return fetch(`https://api.github.com/user`, {
    headers: {
      Authorization: `token ${ctx.token}`
    }
  }).then(response => {
    if (!response.ok) {
      throw new Error('Unable to get user');
    }

    return response.json();
  });
};

function createAuthActor() {
  let listener: ((code: string) => void) | null = null;
  let code: string | null = null;

  return {
    send(_code: string) {
      code = _code;

      if (listener) {
        listener(_code);
      }
    },
    listen(l: (code: string) => void) {
      listener = l;

      if (code) {
        listener(code);
      }
    }
  };
}

function updateQuery(query: Record<string, string | undefined>): void {
  if (!window.history) return;

  const fullQuery = {
    ...queryString.parse(window.location.search),
    ...query
  };

  window.history.replaceState(null, '', `?${queryString.stringify(fullQuery)}`);
}

(window as any).updateQuery = updateQuery;

const authActor = createAuthActor();

(window as any).authCallback = (code: string) => {
  authActor.send(code);
};

const query = queryString.parse(window.location.search);

const appMachine = Machine<AppMachineContext>({
  id: 'app',
  context: {
    query,
    token: process.env.REACT_APP_TEST_TOKEN,
    gist: (query.gist as string) || undefined,
    example: examples.omni,
    user: undefined,
    pendingSave: false
  },
  invoke: [
    {
      id: 'test',
      src: () => cb => {
        authActor.listen(code => {
          cb({ type: 'CODE', code });
        });
      }
    }
  ],
  type: 'parallel',
  states: {
    auth: {
      initial: 'checkingCode',
      states: {
        checkingCode: {
          on: {
            '': [
              {
                target: 'authorizing',
                cond: ctx => {
                  return !!ctx.query.code;
                }
              },
              {
                target: 'gettingUser',
                cond: ctx => {
                  return !!ctx.token;
                }
              },
              {
                target: 'unauthorized',
                actions: assign<AppMachineContext>({
                  example: examples.light
                })
              }
            ]
          }
        },
        authorizing: {
          invoke: {
            src: (ctx, e) => {
              return fetch(
                `http://xstate-gist.azurewebsites.net/api/GistPost?code=${
                  e.code
                }`
              )
                .then(response => {
                  if (!response.ok) {
                    throw new Error('unauthorized');
                  }

                  return response.json();
                })
                .then(data => {
                  if (data.error) {
                    throw new Error('expired code');
                  }

                  return data;
                });
            },
            onDone: {
              target: 'gettingUser',
              actions: assign<AppMachineContext>({
                token: (ctx, e) => e.data.access_token
              })
            },
            onError: {
              target: 'unauthorized',
              actions: (_, e) => alert(e.data)
            }
          }
        },
        gettingUser: {
          invoke: {
            src: getUser,
            onDone: {
              target: 'authorized',
              actions: assign<AppMachineContext>({
                // @ts-ignore
                user: (_, e) => e.data
              })
            },
            onError: 'unauthorized'
          }
        },
        authorized: {
          type: 'parallel',
          states: {
            user: {},
            gist: {
              initial: 'idle',
              states: {
                idle: {
                  initial: 'default',
                  states: {
                    default: {},
                    patched: {
                      after: {
                        1000: 'default'
                      }
                    },
                    posted: {
                      after: {
                        1000: 'default'
                      }
                    }
                  }
                },
                patching: {
                  invoke: {
                    src: invokeSaveGist,
                    onDone: {
                      target: 'idle.patched',
                      actions: [
                        log(),
                        ctx => notificationsActor.notify('Gist saved!')
                      ]
                    },
                    onError: {
                      target: 'idle',
                      actions: (ctx, e) =>
                        notificationsActor.notify({
                          message: 'Unable to save machine',
                          severity: 'error',
                          description: e.data.message
                        })
                    }
                  }
                },
                posting: {
                  invoke: {
                    src: invokePostGist,
                    onDone: {
                      target: 'idle.posted',
                      actions: [
                        assign<AppMachineContext>({
                          gist: (_, e) => e.data.id
                        }),
                        () => notificationsActor.notify('Gist created!'),
                        ({ gist }) => updateQuery({ gist: gist! })
                      ]
                    }
                  }
                }
              },
              on: {
                '': {
                  actions: [
                    assign<AppMachineContext>({ pendingSave: false }),
                    send('GIST.SAVE')
                  ],
                  cond: ctx => ctx.pendingSave
                },
                'GIST.SAVE': [
                  {
                    target: '.idle',
                    cond: (_, e) => {
                      try {
                        const machine = toMachine(e.code);
                        getEdges(machine);
                      } catch (e) {
                        notificationsActor.notify({
                          message: 'Failed to save machine',
                          severity: 'error',
                          description: e.message
                        });
                        return true;
                      }

                      return false;
                    }
                  },
                  { target: '.patching', cond: ctx => !!ctx.gist },
                  { target: '.posting' }
                ]
              }
            }
          },
          on: {
            LOGOUT: {
              target: 'unauthorized',
              actions: assign<AppMachineContext>({
                token: undefined,
                user: undefined
              })
            }
          }
        },
        unauthorized: {
          on: {
            LOGIN: 'pendingAuthorization',
            'GIST.SAVE': {
              target: 'pendingAuthorization',
              actions: assign<AppMachineContext>({ pendingSave: true })
            }
          }
        },
        pendingAuthorization: {
          entry: () => {
            window.open(
              'https://github.com/login/oauth/authorize?client_id=39c1ec91c4ed507f6e4c&scope=gist',
              'Login with GitHub',
              'width=800,height=600'
            );
          },
          on: {
            CODE: 'authorizing'
          }
        }
      },
      on: {
        LOGIN: '.pendingAuthorization'
      }
    },
    gist: {
      initial: 'checking',
      states: {
        checking: {
          on: {
            '': [
              { target: 'fetching', cond: ctx => !!ctx.query.gist },
              { target: 'idle' }
            ]
          }
        },
        idle: {},

        fetching: {
          invoke: {
            src: invokeFetchGist,
            onDone: {
              target: 'loaded',
              actions: assign<AppMachineContext>({
                // @ts-ignore
                example: (_, e) => {
                  return e.data.files['machine.js'].content;
                }
              })
            },
            onError: {
              target: 'idle',
              actions: [
                assign<AppMachineContext>({
                  gist: undefined
                }),
                ctx => notificationsActor.notify('Gist not found.')
              ]
            }
          }
        },
        loaded: {
          entry: (ctx, e) => notificationsActor.notify('Gist loaded!')
        }
      }
    }
  }
});

export const AppContext = createContext<{
  state: State<AppMachineContext>;
  send: (event: any) => void;
  service: Interpreter<AppMachineContext>;
}>({ state: appMachine.initialState, send: () => {}, service: {} as any });

function layoutReducer(state: string, event: string) {
  switch (state) {
    case 'full':
      switch (event) {
        case 'TOGGLE':
          return 'viz';
        default:
          return state;
      }
    case 'viz':
      switch (event) {
        case 'TOGGLE':
          return 'full';
        default:
          return state;
      }
    default:
      return state;
  }
}

export function App() {
  const [current, send, service] = useMachine(appMachine);
  const [layout, dispatchLayout] = useReducer(
    layoutReducer,
    (query.layout as string) || 'full'
  );

  return (
    <StyledApp data-layout={layout}>
      <AppContext.Provider value={{ state: current, send, service }}>
        <User />
        <Header />
        {current.matches({ gist: 'fetching' }) ? (
          <Loader />
        ) : (
          <>
            <StateChart
              machine={current.context.example}
              onSave={code => {
                send('GIST.SAVE', { code });
              }}
            />
            <LayoutButton onClick={() => dispatchLayout('TOGGLE')}>
              {({ full: 'Hide', viz: 'Code' } as Record<string, string>)[
                layout
              ] || 'Show'}
            </LayoutButton>
          </>
        )}
      </AppContext.Provider>
    </StyledApp>
  );
}
