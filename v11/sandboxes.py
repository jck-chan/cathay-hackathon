"""Registry of independent v11 simulations."""
from dataclasses import dataclass
from threading import Lock
from typing import Literal
from uuid import uuid4

from .conductor import Conductor

DispatchPolicy = Literal['fcfs', 'relay']


@dataclass(frozen=True)
class Sandbox:
    id: str
    name: str
    conductor: Conductor

    @property
    def policy(self) -> str:
        return self.conductor.lab.ground_policy


class SandboxManager:
    def __init__(self, *sandboxes: Sandbox):
        self._sandboxes = {sandbox.id: sandbox for sandbox in sandboxes}
        self._lock = Lock()

    def create(self, name: str, *, policy: DispatchPolicy = 'relay', seed: int = 2048) -> Sandbox:
        name = name.strip()
        if not name:
            raise ValueError('Enter a sandbox name')
        if policy not in ('fcfs', 'relay'):
            raise ValueError(f'Unknown dispatch policy: {policy}')
        conductor = Conductor(seed=seed, dispatch_policies=(policy,))
        sandbox = Sandbox(uuid4().hex, name, conductor)
        with self._lock:
            self._sandboxes[sandbox.id] = sandbox
        return sandbox

    def get(self, sandbox_id: str) -> Sandbox:
        with self._lock:
            return self._sandboxes[sandbox_id]

    def list(self) -> tuple[Sandbox, ...]:
        with self._lock:
            return tuple(self._sandboxes.values())

    def delete(self, sandbox_id: str) -> None:
        with self._lock:
            sandbox = self._sandboxes.pop(sandbox_id)
        sandbox.conductor.close()
