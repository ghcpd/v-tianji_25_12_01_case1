/**
 * Event Bus System
 * 
 * Implements a publish-subscribe pattern for decoupled event handling.
 * Supports event filtering, middleware, and async event processing.
 */

import { EventPayload, EventHandler } from '../types';
import { logger } from '../utils/logger';

interface EventSubscription {
  id: string;
  handler: EventHandler;
  filter?: (payload: EventPayload) => boolean;
  priority: number;
}

export class EventBus {
  private subscriptions: Map<string, EventSubscription[]> = new Map();
  private middleware: Array<(payload: EventPayload) => Promise<EventPayload> | EventPayload> = [];
  private subscriptionCounter = 0;

  /**
   * Subscribe to events of a specific type
   */
  subscribe(
    eventType: string,
    handler: EventHandler,
    options?: {
      filter?: (payload: EventPayload) => boolean;
      priority?: number;
    }
  ): string {
    const subscriptionId = `sub_${++this.subscriptionCounter}_${Date.now()}`;
    
    if (!this.subscriptions.has(eventType)) {
      this.subscriptions.set(eventType, []);
    }

    const subscription: EventSubscription = {
      id: subscriptionId,
      handler,
      filter: options?.filter,
      priority: options?.priority || 0
    };

    const subscriptions = this.subscriptions.get(eventType)!;
    subscriptions.push(subscription);
    subscriptions.sort((a, b) => b.priority - a.priority);

    logger.debug('Event subscription created', {
      eventType,
      subscriptionId,
      priority: subscription.priority
    });

    return subscriptionId;
  }

  /**
   * Unsubscribe from events
   */
  unsubscribe(eventType: string, subscriptionId: string): boolean {
    const subscriptions = this.subscriptions.get(eventType);
    if (!subscriptions) {
      return false;
    }

    const index = subscriptions.findIndex(sub => sub.id === subscriptionId);
    if (index === -1) {
      return false;
    }

    subscriptions.splice(index, 1);
    logger.debug('Event subscription removed', { eventType, subscriptionId });
    return true;
  }

  /**
   * Add middleware to process events before handlers
   */
  use(middleware: (payload: EventPayload) => Promise<EventPayload> | EventPayload): void {
    this.middleware.push(middleware);
  }

  /**
   * Publish an event to all subscribers
   */
  async publish(eventType: string, data: unknown, correlationId?: string): Promise<void> {
    const payload: EventPayload = {
      type: eventType,
      data,
      correlationId: correlationId || this.generateCorrelationId(),
      timestamp: Date.now()
    };

    logger.debug('Event published', {
      eventType,
      correlationId: payload.correlationId
    });

    let processedPayload = payload;
    for (const middleware of this.middleware) {
      processedPayload = await middleware(processedPayload);
    }

    const subscriptions = this.subscriptions.get(eventType) || [];
    const matchingSubscriptions = subscriptions.filter(sub => {
      if (!sub.filter) {
        return true;
      }
      return sub.filter(processedPayload);
    });

    const handlerPromises = matchingSubscriptions.map(async (subscription) => {
      try {
        await subscription.handler(processedPayload);
      } catch (error) {
        logger.error('Event handler error', error as Error, {
          eventType,
          subscriptionId: subscription.id,
          correlationId: processedPayload.correlationId
        });
      }
    });

    await Promise.allSettled(handlerPromises);
  }

  /**
   * Get all subscriptions for an event type
   */
  getSubscriptions(eventType: string): EventSubscription[] {
    return this.subscriptions.get(eventType) || [];
  }

  /**
   * Clear all subscriptions
   */
  clear(): void {
    this.subscriptions.clear();
    this.middleware = [];
    logger.info('Event bus cleared');
  }

  private generateCorrelationId(): string {
    return `corr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

export const eventBus = new EventBus();

